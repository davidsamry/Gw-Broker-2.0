import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import type { OtcAssetConfig, OtcAssetState, OtcCandle, OtcRegime, OtcTick } from './types.js'
import { CANDLES_PER_TF, ENGINE_TICK_INTERVAL_MS, OTC_TIMEFRAMES } from './types.js'
import { maybeTransitionRegime, pickRegimeDurationMs, stepLiquidity, stepPrice } from './pricingEngine.js'
import { CandleBuilder } from './candleBuilder.js'
import { bootstrapHistoricalCandles, loadLatestCandlePerTimeframe } from './bootstrap.js'
import { publishCandle, publishTick } from './events.js'

// OTC v2 worker — singleton orchestrator. Runs one tick loop per asset
// and one liquidity update loop per asset. Persistence is batched to
// keep the DB happy. Etapas 3+ wire endpoints on top; this file is
// pure engine + I/O.

const TICK_FLUSH_INTERVAL_MS      = 1_000   // batched tick INSERTs
const LIQUIDITY_UPDATE_INTERVAL_MS = 10_000

// ── In-memory state ────────────────────────────────────────────────────
const assetStates = new Map<string, OtcAssetState>()
// Per-asset candle builders, one per timeframe
const builders    = new Map<string, CandleBuilder[]>()
// Bounded ring buffer of recent candles per (asset:tf) — what the REST
// endpoint serves (Etapa 3) without hitting DB. Size = CANDLES_PER_TF.
const candleCache = new Map<string, OtcCandle[]>()

// Pending writes (flushed every TICK_FLUSH_INTERVAL_MS)
const pendingTicks:   OtcTick[]   = []
const pendingCandles: OtcCandle[] = []

let tickIntervals:      Array<ReturnType<typeof setInterval>> = []
let flushInterval:      ReturnType<typeof setInterval> | null = null
let liquidityInterval:  ReturnType<typeof setInterval> | null = null
let isRunning = false

// ── Boot ───────────────────────────────────────────────────────────────
// Boots the engine. If it can't load assets on first try (e.g., DB
// not ready yet, or transient connection issue), it backs off and
// retries up to 5 times before giving up — previously a single boot
// failure left the worker permanently dead until the next deploy.
export async function startOtcV2Worker(): Promise<void> {
  if (isRunning) return
  isRunning = true

  console.log('[otc-v2] booting…')

  let configs: OtcAssetConfig[] = []
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      configs = await loadAssetConfigs()
      if (configs.length > 0) break
      console.warn(`[otc-v2] attempt ${attempt}: otc_assets returned 0 rows`)

      // First time we see an empty table, try to self-heal by inserting
      // the canonical 5 launch assets. This decouples the engine from
      // the migrate-deploy pipeline — if migrations never ran (e.g.,
      // schema initialized via `db push`, no _prisma_migrations table),
      // the worker will still come up on its own. Idempotent via
      // ON CONFLICT DO NOTHING.
      if (attempt === 1) {
        try {
          await selfHealSeed()
          console.warn('[otc-v2] inline seed attempted — will retry loadAssetConfigs')
        } catch (err) {
          console.error('[otc-v2] inline seed failed:', err)
        }
      }
    } catch (err) {
      console.error(`[otc-v2] attempt ${attempt}: loadAssetConfigs failed`, err)
    }
    await new Promise(r => setTimeout(r, attempt * 2_000))
  }

  if (configs.length === 0) {
    console.error('[otc-v2] BOOT GAVE UP — no assets loaded after 5 attempts. Routes will return ASSET_NOT_FOUND until next restart.')
    isRunning = false
    return
  }

  try {
    // 1. Bootstrap historical candles (first deploy only — idempotent
    //    via per-(asset, tf) try/catch + ON CONFLICT DO NOTHING).
    await bootstrapHistoricalCandles(configs)

    // 2. Hydrate in-memory state from DB. Per-asset try/catch so a
    //    bad row for one asset doesn't strand the other four.
    const latestCandles = await loadLatestCandlePerTimeframe(configs.map(c => c.id))
    for (const cfg of configs) {
      try {
        assetStates.set(cfg.id, buildInitialState(cfg, latestCandles))

        const cbs: CandleBuilder[] = []
        for (const tf of OTC_TIMEFRAMES) {
          const cb = new CandleBuilder(cfg.id, tf)
          cb.seedFromCandle(latestCandles.get(`${cfg.id}:${tf}`) ?? null)
          cbs.push(cb)
        }
        builders.set(cfg.id, cbs)

        await primeCandleCache(cfg.id)
      } catch (err) {
        console.error(`[otc-v2] hydrate failed for ${cfg.id} — skipping`, err)
        assetStates.delete(cfg.id)
        builders.delete(cfg.id)
      }
    }

    // 3. Start one tick interval per successfully hydrated asset.
    for (const cfg of configs) {
      if (assetStates.has(cfg.id)) startAssetLoop(cfg.id)
    }

    // 4. Start the periodic flush + liquidity loops
    flushInterval = setInterval(flushPending, TICK_FLUSH_INTERVAL_MS)
    liquidityInterval = setInterval(() => {
      for (const state of assetStates.values()) {
        if (state.config.paused) continue
        stepLiquidity(state)
      }
    }, LIQUIDITY_UPDATE_INTERVAL_MS)

    console.log(`[otc-v2] running with ${assetStates.size}/${configs.length} assets, ${OTC_TIMEFRAMES.length} timeframes`)
  } catch (err) {
    console.error('[otc-v2] post-config boot failed', err)
    isRunning = false
  }
}

export function stopOtcV2Worker(): void {
  for (const it of tickIntervals) clearInterval(it)
  tickIntervals = []
  if (flushInterval)     { clearInterval(flushInterval);     flushInterval = null     }
  if (liquidityInterval) { clearInterval(liquidityInterval); liquidityInterval = null }
  // Flush remaining writes on shutdown
  void flushPending()
  isRunning = false
}

// ── Per-asset tick loop ────────────────────────────────────────────────
function startAssetLoop(assetId: string): void {
  const state = assetStates.get(assetId)
  if (!state) return
  const period = Math.max(50, Math.round(ENGINE_TICK_INTERVAL_MS / Math.max(0.1, state.config.speedMultiplier)))

  const id = setInterval(() => {
    const s = assetStates.get(assetId)
    if (!s || !s.config.enabled || s.config.paused) return

    const now = Date.now()
    maybeTransitionRegime(s, now)

    const price = stepPrice(s)
    const tick: OtcTick = { assetId: s.config.id, price: round5(price), recordedAt: new Date(now) }
    pendingTicks.push(tick)

    // Publish raw tick to the bus — SSE subscribers throttle as needed
    // so the engine doesn't have to know per-client cadence.
    publishTick({ assetId: tick.assetId, price: tick.price, time: now })

    // Feed all timeframe builders for this asset
    const cbs = builders.get(assetId) ?? []
    for (const cb of cbs) {
      const { current, finalized } = cb.onTick(tick.price, now)
      // Update cache — replace last (current) entry if it shares openTime
      const cacheKey = `${assetId}:${cb.timeframe}`
      const buf = candleCache.get(cacheKey) ?? []
      const last = buf[buf.length - 1]
      if (last && last.openTime.getTime() === current.openTime.getTime()) {
        buf[buf.length - 1] = current
      } else {
        buf.push(current)
        // Trim to cap
        if (buf.length > CANDLES_PER_TF) buf.shift()
      }
      candleCache.set(cacheKey, buf)

      // Live update for chart subscribers (SSE throttles to ~1Hz/client)
      publishCandle({
        assetId, timeframe: cb.timeframe,
        openTime: current.openTime.getTime(),
        open: current.open, high: current.high, low: current.low, close: current.close,
        isClosed: false,
      })

      // Queue persist on finalized AND emit the closing event for the bar.
      if (finalized) {
        pendingCandles.push(finalized)
        publishCandle({
          assetId, timeframe: cb.timeframe,
          openTime: finalized.openTime.getTime(),
          open: finalized.open, high: finalized.high, low: finalized.low, close: finalized.close,
          isClosed: true,
        })
      }
    }
  }, period)

  tickIntervals.push(id)
}

// ── Persistence flush ──────────────────────────────────────────────────
async function flushPending(): Promise<void> {
  // Snapshot + clear (concurrent ticks during the await will be picked
  // up on the next flush — they're already in cache for serving).
  const ticks   = pendingTicks.splice(0)
  const candles = pendingCandles.splice(0)

  if (ticks.length > 0) {
    try {
      const values = ticks.map(t => Prisma.sql`(${t.assetId}, ${t.price}, ${t.recordedAt})`)
      await prisma.$executeRaw`
        INSERT INTO otc_ticks ("assetId", price, "recordedAt")
        VALUES ${Prisma.join(values, ', ')}
      `
    } catch (err) {
      console.error('[otc-v2] tick flush failed', err)
    }
  }

  if (candles.length > 0) {
    try {
      const values = candles.map(c => Prisma.sql`(
        ${c.assetId}, ${c.timeframe}, ${c.openTime},
        ${c.open}, ${c.high}, ${c.low}, ${c.close},
        ${c.tickCount}, ${c.finalizedAt}
      )`)
      // ON CONFLICT updates ALL OHLC including openPrice. The previous
      // omit-openPrice strategy was meant to "lock in" the first tick's
      // open, but it created divergence: a re-seeded CandleBuilder (post-
      // restart) would update h/l/c via this UPSERT while leaving an
      // orphan openPrice from a previous run. The result was structurally
      // broken candles (open > high, open < low). Now the DB always
      // reflects the worker's current finalized state — single source of
      // truth, no drift.
      await prisma.$executeRaw`
        INSERT INTO otc_candles
          ("assetId", timeframe, "openTime", "openPrice", "highPrice", "lowPrice", "closePrice", "tickCount", "finalizedAt")
        VALUES ${Prisma.join(values, ', ')}
        ON CONFLICT ("assetId", timeframe, "openTime")
        DO UPDATE SET
          "openPrice"   = EXCLUDED."openPrice",
          "highPrice"   = EXCLUDED."highPrice",
          "lowPrice"    = EXCLUDED."lowPrice",
          "closePrice"  = EXCLUDED."closePrice",
          "tickCount"   = EXCLUDED."tickCount",
          "finalizedAt" = EXCLUDED."finalizedAt"
      `
    } catch (err) {
      console.error('[otc-v2] candle flush failed', err)
    }
  }
}

// ── Reads (used by routes — Etapa 3) ───────────────────────────────────
export function getCachedCandles(assetId: string, tf: number, limit: number = CANDLES_PER_TF): OtcCandle[] {
  const buf = candleCache.get(`${assetId}:${tf}`) ?? []
  return buf.slice(-Math.min(limit, buf.length))
}

export function getCurrentPrice(assetId: string): number | null {
  const s = assetStates.get(assetId)
  return s ? round5(s.smoothedPrice) : null
}

export function listEngineAssets(): OtcAssetConfig[] {
  return Array.from(assetStates.values()).map(s => s.config)
}

// Exposed for Etapa 6 (admin "reload after seedPrice/volatility edits")
export async function reloadOtcV2Assets(): Promise<number> {
  const configs = await loadAssetConfigs()
  for (const cfg of configs) {
    const existing = assetStates.get(cfg.id)
    if (existing) {
      existing.config = cfg
    } else {
      assetStates.set(cfg.id, buildInitialState(cfg, new Map()))
      const cbs = OTC_TIMEFRAMES.map(tf => new CandleBuilder(cfg.id, tf))
      builders.set(cfg.id, cbs)
      await primeCandleCache(cfg.id)
      startAssetLoop(cfg.id)
    }
  }
  return configs.length
}

// ── Etapa 6 admin surface ──────────────────────────────────────────────
// Read snapshot of an asset's live in-memory state — what the engine is
// "thinking" right now. Powers the admin panel cards (regime chip,
// pressure bars, current price). null = engine hasn't loaded this asset
// (rare: only on first deploy before bootstrap finishes).
export interface OtcAssetLiveState {
  id:               string
  price:            number
  smoothedPrice:    number
  regime:           OtcRegime
  regimeStartedAt:  number      // epoch ms
  regimeDurationMs: number
  spread:           number
  buyPressure:      number
  sellPressure:     number
  volume:           number
  depth:            number
  speed:            number
  trendBias:        number
  enabled:          boolean
  paused:           boolean
}

function snapshotLiveState(s: OtcAssetState): OtcAssetLiveState {
  return {
    id:               s.config.id,
    price:            round5(s.price),
    smoothedPrice:    round5(s.smoothedPrice),
    regime:           s.regime,
    regimeStartedAt:  s.regimeStartedAt,
    regimeDurationMs: s.regimeDurationMs,
    spread:           s.spread,
    buyPressure:      s.buyPressure,
    sellPressure:     s.sellPressure,
    volume:           s.volume,
    depth:            s.depth,
    speed:            s.speed,
    trendBias:        s.trendBias,
    enabled:          s.config.enabled,
    paused:           s.config.paused,
  }
}

export function getAssetLiveState(assetId: string): OtcAssetLiveState | null {
  const s = assetStates.get(assetId)
  return s ? snapshotLiveState(s) : null
}

export function listAssetLiveStates(): OtcAssetLiveState[] {
  return Array.from(assetStates.values()).map(snapshotLiveState)
}

// Admin nudges the regime drift in a direction without forcing a specific
// regime. Clamped to [-1, +1]; multiplied by 0.0001 in stepPrice so a max
// bias adds ~10bp of drift per tick — strong enough to skew direction over
// minutes without overwhelming the regime FSM.
export function setAssetTrendBias(assetId: string, bias: number): boolean {
  const s = assetStates.get(assetId)
  if (!s) return false
  s.trendBias = Math.max(-1, Math.min(1, bias))
  return true
}

// Snap price + regime + liquidity back to baseline. Used when admin sees
// the chart drift into a weird state and wants a clean reset without
// restarting the API process. Does NOT touch finalized candles — the
// audit trail of what users actually saw stays intact; the next live
// candle just opens at seedPrice.
export function resetAssetState(assetId: string): boolean {
  const s = assetStates.get(assetId)
  if (!s) return false
  s.price            = s.config.seedPrice
  s.smoothedPrice    = s.config.seedPrice
  s.regime           = 'LATERAL'
  s.regimeStartedAt  = Date.now()
  s.regimeDurationMs = pickRegimeDurationMs('LATERAL')
  s.spread           = 0.0001
  s.buyPressure      = 0.5
  s.sellPressure     = 0.5
  s.volume           = 1.0
  s.depth            = 1.0
  s.speed            = 1.0
  s.trendBias        = 0
  return true
}

// ── Internals ──────────────────────────────────────────────────────────

// Inserts the canonical 5 launch OTC assets if otc_assets is empty.
// Mirrors migration 20260524155500_otc_v2_seed but runs inline at
// engine boot so we don't depend on `prisma migrate deploy` succeeding
// in production. Volatility values match the calibrated post-deploy
// settings (migration 20260524182500), not the original wild defaults.
async function selfHealSeed(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO otc_assets
      (id, symbol, name, category, enabled, paused, payout,
       "seedPrice", "volatilityBase", "speedMultiplier",
       "displayOrder", "createdAt", "updatedAt")
    VALUES
      ('eur-usd-otc', 'EUR/USD', 'EUR/USD (OTC)', 'FOREX'::"OtcCategory",       TRUE, FALSE, 85,     1.08500, 0.00020, 1.0, 1, NOW(), NOW()),
      ('gbp-jpy-otc', 'GBP/JPY', 'GBP/JPY (OTC)', 'FOREX'::"OtcCategory",       TRUE, FALSE, 87,   198.50000, 0.00030, 1.0, 2, NOW(), NOW()),
      ('btc-usd-otc', 'BTC/USD', 'BTC/USD (OTC)', 'CRYPTO'::"OtcCategory",      TRUE, FALSE, 82, 68000.00000, 0.00080, 1.0, 3, NOW(), NOW()),
      ('gold-otc',    'GOLD',    'GOLD (OTC)',    'COMMODITIES'::"OtcCategory", TRUE, FALSE, 80,  2350.00000, 0.00025, 1.0, 4, NOW(), NOW()),
      ('nasdaq-otc',  'NASDAQ',  'NASDAQ (OTC)',  'INDICES'::"OtcCategory",     TRUE, FALSE, 78, 18450.00000, 0.00022, 1.0, 5, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO otc_market_state
      ("assetId", "currentRegime", "regimeStartedAt", "regimeDurationS", "currentDrift", "currentVol", "trendBias", "updatedAt")
    SELECT id, 'LATERAL'::"OtcRegime", NOW(), 60, 0, "volatilityBase", 0, NOW()
    FROM otc_assets
    WHERE id IN ('eur-usd-otc','gbp-jpy-otc','btc-usd-otc','gold-otc','nasdaq-otc')
    ON CONFLICT ("assetId") DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO otc_liquidity_state
      ("assetId", spread, "buyPressure", "sellPressure", volume, depth, speed, "updatedAt")
    SELECT id, 0.0001, 0.5, 0.5, 1.0, 1.0, 1.0, NOW()
    FROM otc_assets
    WHERE id IN ('eur-usd-otc','gbp-jpy-otc','btc-usd-otc','gold-otc','nasdaq-otc')
    ON CONFLICT ("assetId") DO NOTHING
  `
}

async function loadAssetConfigs(): Promise<OtcAssetConfig[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; seedPrice: string; volatilityBase: number;
    speedMultiplier: number; enabled: boolean; paused: boolean
  }>>`
    SELECT id, "seedPrice"::text AS "seedPrice", "volatilityBase",
           "speedMultiplier", enabled, paused
    FROM otc_assets
    ORDER BY "displayOrder" ASC, symbol ASC
  `
  return rows.map(r => ({
    id:              r.id,
    seedPrice:       Number(r.seedPrice),
    volatilityBase:  r.volatilityBase,
    speedMultiplier: r.speedMultiplier,
    enabled:         r.enabled,
    paused:          r.paused,
  }))
}

function buildInitialState(cfg: OtcAssetConfig, latestCandles: Map<string, OtcCandle | null>): OtcAssetState {
  // Resume from the latest candle's close so a restart doesn't snap
  // back to seedPrice (and create a discontinuity for users).
  const lastTfCandle = latestCandles.get(`${cfg.id}:60`) ?? null
  const startPrice = lastTfCandle ? lastTfCandle.close : cfg.seedPrice
  const initialRegime: OtcRegime = 'LATERAL'
  return {
    config:           cfg,
    price:            startPrice,
    smoothedPrice:    startPrice,
    regime:           initialRegime,
    regimeStartedAt:  Date.now(),
    regimeDurationMs: pickRegimeDurationMs(initialRegime),
    spread:           0.0001,
    buyPressure:      0.5,
    sellPressure:     0.5,
    volume:           1.0,
    depth:            1.0,
    speed:            1.0,
    trendBias:        0,
  }
}

async function primeCandleCache(assetId: string): Promise<void> {
  for (const tf of OTC_TIMEFRAMES) {
    const rows = await prisma.$queryRaw<Array<{
      openTime: Date; openPrice: string; highPrice: string;
      lowPrice: string; closePrice: string; tickCount: number;
      finalizedAt: Date | null
    }>>`
      SELECT "openTime", "openPrice"::text, "highPrice"::text,
             "lowPrice"::text, "closePrice"::text, "tickCount", "finalizedAt"
      FROM otc_candles
      WHERE "assetId" = ${assetId} AND timeframe = ${tf}
      ORDER BY "openTime" DESC
      LIMIT ${CANDLES_PER_TF}
    `
    const buf: OtcCandle[] = rows.map(r => ({
      assetId,
      timeframe: tf,
      openTime: r.openTime,
      open:  Number(r.openPrice),
      high:  Number(r.highPrice),
      low:   Number(r.lowPrice),
      close: Number(r.closePrice),
      tickCount: r.tickCount,
      finalizedAt: r.finalizedAt,
    })).reverse()  // ascending for the cache
    candleCache.set(`${assetId}:${tf}`, buf)
  }
}

function round5(v: number): number {
  return Math.round(v * 100000) / 100000
}
