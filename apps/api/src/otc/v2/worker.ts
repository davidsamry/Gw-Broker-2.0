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
// How often the in-memory regime + liquidity + trendBias get persisted
// to otc_market_state / otc_liquidity_state. The interval is short
// enough that a deploy loses < 5 seconds of evolution; long enough that
// we don't hammer the DB with redundant writes.
const STATE_FLUSH_INTERVAL_MS      = 5_000
// How long to suppress random spikes after boot so the first tick post-
// restart doesn't accidentally introduce a discontinuity that the user
// would read as "the engine snapped to a new price on deploy".
const BOOT_SPIKE_GRACE_MS          = 10_000
// Periodic gap sweep — re-runs backfill against the live DB to catch
// any slot gaps that opened up since the last sweep (boot restart that
// didn't have the backfill code yet, transient outage between deploys,
// etc.). Cheap when there's nothing to fill (one COUNT query per
// asset/tf, returns immediately).
const GAP_SWEEP_INTERVAL_MS        = 30_000
// Periodic prune — caps DB growth. Without this, otc_ticks alone
// accumulates ~4.3M rows/day (5 assets × 10Hz × 86400s) and the table
// would hit GB-scale within a week. Retention windows are sized to
// stay well above the chart's 3000-candle cap per timeframe so users
// never run out of scrollback history.
const PRUNE_INTERVAL_MS            = 5 * 60_000

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
let stateFlushInterval: ReturnType<typeof setInterval> | null = null
let gapSweepInterval:   ReturnType<typeof setInterval> | null = null
let pruneInterval:      ReturnType<typeof setInterval> | null = null
let isRunning = false
let bootedAt = 0

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
    //    bad row for one asset doesn't strand the other four. ALSO
    //    backfills any candle slots that elapsed during the downtime
    //    so the chart resumes without a time gap.
    const latestCandles = await loadLatestCandlePerTimeframe(configs.map(c => c.id))
    const persistedStates = await loadPersistedRuntimeStates(configs.map(c => c.id))
    for (const cfg of configs) {
      try {
        // Backfill missing candles BEFORE seeding builders, so they
        // pick up the freshly-inserted "downtime" slot as their state.
        const last60 = latestCandles.get(`${cfg.id}:60`)
        if (last60) {
          await backfillMissingCandles(cfg, last60)
          // Re-read latest after backfill so builder seeds match DB.
          const refreshed = await loadLatestCandlePerTimeframe([cfg.id])
          for (const tf of OTC_TIMEFRAMES) {
            const k = `${cfg.id}:${tf}`
            const c = refreshed.get(k)
            if (c) latestCandles.set(k, c)
          }
        }

        assetStates.set(cfg.id, buildInitialState(cfg, latestCandles, persistedStates.get(cfg.id)))

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
    bootedAt = Date.now()
    flushInterval = setInterval(flushPending, TICK_FLUSH_INTERVAL_MS)
    liquidityInterval = setInterval(() => {
      for (const state of assetStates.values()) {
        if (state.config.paused) continue
        stepLiquidity(state)
      }
    }, LIQUIDITY_UPDATE_INTERVAL_MS)
    // Persist regime + liquidity + trendBias so the next boot can
    // resume without resetting momentum. Survives `prisma migrate
    // deploy` because we never truncate these tables.
    stateFlushInterval = setInterval(flushRuntimeState, STATE_FLUSH_INTERVAL_MS)
    // Periodic gap sweep — checks each asset/tf for missing slots
    // and backfills them. Catches gaps that opened up between deploys
    // (e.g., from older code that didn't have boot-time backfill).
    gapSweepInterval = setInterval(() => { void sweepAllGaps() }, GAP_SWEEP_INTERVAL_MS)
    // Periodic prune — TEMPORARILY DISABLED.
    // The first drain after a long accumulation was saturating the
    // Prisma connection pool (otc_ticks has no recordedAt-only index,
    // so even chunked DELETEs scan a lot). Auth/login was returning
    // 500 INTERNAL_ERROR because findUnique on users couldn't get a
    // connection. Re-enable after adding an index migration.
    // void pruneOldData()
    // pruneInterval = setInterval(() => { void pruneOldData() }, PRUNE_INTERVAL_MS)

    console.log(`[otc-v2] running with ${assetStates.size}/${configs.length} assets, ${OTC_TIMEFRAMES.length} timeframes`)
  } catch (err) {
    console.error('[otc-v2] post-config boot failed', err)
    isRunning = false
  }
}

// Returns ms since boot — used by stepPrice() to suppress spikes during
// the grace window so the first ticks after restart can't introduce a
// visible discontinuity in the chart.
export function msSinceBoot(): number {
  return bootedAt === 0 ? Number.MAX_SAFE_INTEGER : Date.now() - bootedAt
}

export function isWithinBootGrace(): boolean {
  return msSinceBoot() < BOOT_SPIKE_GRACE_MS
}

export function stopOtcV2Worker(): void {
  for (const it of tickIntervals) clearInterval(it)
  tickIntervals = []
  if (flushInterval)      { clearInterval(flushInterval);      flushInterval      = null }
  if (liquidityInterval)  { clearInterval(liquidityInterval);  liquidityInterval  = null }
  if (stateFlushInterval) { clearInterval(stateFlushInterval); stateFlushInterval = null }
  if (gapSweepInterval)   { clearInterval(gapSweepInterval);   gapSweepInterval   = null }
  if (pruneInterval)      { clearInterval(pruneInterval);      pruneInterval      = null }
  // Final flush of both candle-level data AND runtime state, so a
  // graceful shutdown loses zero context for the next boot.
  void flushPending()
  void flushRuntimeState()
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
    // Tag the boot grace window — stepPrice reads s.bootGrace to skip
    // its random-spike branch during the first BOOT_SPIKE_GRACE_MS so
    // the first post-restart candle never introduces a fake jump.
    s.bootGrace = isWithinBootGrace()
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

// Stateful resume: prefers the persisted runtime state (regime,
// liquidity, trendBias) over default values so a restart picks up
// exactly where the previous engine left off. Falls back to defaults
// only when there's no row in otc_market_state / otc_liquidity_state
// (first boot ever for this asset, or fresh DB).
function buildInitialState(
  cfg:             OtcAssetConfig,
  latestCandles:   Map<string, OtcCandle | null>,
  persisted?:      PersistedRuntimeState,
): OtcAssetState {
  // Resume price from the latest candle's close — same as before.
  const lastTfCandle = latestCandles.get(`${cfg.id}:60`) ?? null
  const startPrice = lastTfCandle ? lastTfCandle.close : cfg.seedPrice

  // Regime — if we have a persisted regime and it hasn't run out of
  // duration during the downtime, keep it. Otherwise enter LATERAL
  // (the FSM will transition naturally).
  let regime: OtcRegime = 'LATERAL'
  let regimeStartedAt   = Date.now()
  let regimeDurationMs  = pickRegimeDurationMs(regime)
  if (persisted?.regime && persisted.regimeStartedAt) {
    const elapsed = Date.now() - persisted.regimeStartedAt.getTime()
    const remaining = (persisted.regimeDurationS ?? 60) * 1000 - elapsed
    if (remaining > 5_000) {
      // Regime still has > 5s left — resume it with the remaining time.
      regime           = persisted.regime
      regimeStartedAt  = persisted.regimeStartedAt.getTime()
      regimeDurationMs = (persisted.regimeDurationS ?? 60) * 1000
    }
  }

  return {
    config:           cfg,
    price:            startPrice,
    smoothedPrice:    startPrice,
    regime,
    regimeStartedAt,
    regimeDurationMs,
    spread:           persisted?.spread       ?? 0.0001,
    buyPressure:      persisted?.buyPressure  ?? 0.5,
    sellPressure:     persisted?.sellPressure ?? 0.5,
    volume:           persisted?.volume       ?? 1.0,
    depth:            persisted?.depth        ?? 1.0,
    speed:            persisted?.speed        ?? 1.0,
    trendBias:        persisted?.trendBias    ?? 0,
  }
}

// What we read out of otc_market_state + otc_liquidity_state at boot.
// All fields optional because either table might be missing rows for a
// brand-new asset.
interface PersistedRuntimeState {
  regime?:          OtcRegime
  regimeStartedAt?: Date
  regimeDurationS?: number
  trendBias?:       number
  spread?:          number
  buyPressure?:     number
  sellPressure?:    number
  volume?:          number
  depth?:           number
  speed?:           number
}

async function loadPersistedRuntimeStates(assetIds: string[]): Promise<Map<string, PersistedRuntimeState>> {
  const out = new Map<string, PersistedRuntimeState>()
  if (assetIds.length === 0) return out
  try {
    const ms = await prisma.$queryRaw<Array<{
      assetId: string; currentRegime: OtcRegime;
      regimeStartedAt: Date; regimeDurationS: number;
      trendBias: number;
    }>>`
      SELECT "assetId", "currentRegime", "regimeStartedAt",
             "regimeDurationS", "trendBias"
      FROM otc_market_state
      WHERE "assetId" = ANY(${assetIds}::text[])
    `
    for (const r of ms) {
      out.set(r.assetId, {
        regime:          r.currentRegime,
        regimeStartedAt: r.regimeStartedAt,
        regimeDurationS: r.regimeDurationS,
        trendBias:       r.trendBias,
      })
    }
    const ls = await prisma.$queryRaw<Array<{
      assetId: string; spread: number; buyPressure: number; sellPressure: number;
      volume: number; depth: number; speed: number;
    }>>`
      SELECT "assetId", spread, "buyPressure", "sellPressure",
             volume, depth, speed
      FROM otc_liquidity_state
      WHERE "assetId" = ANY(${assetIds}::text[])
    `
    for (const r of ls) {
      const existing = out.get(r.assetId) ?? {}
      out.set(r.assetId, {
        ...existing,
        spread:       r.spread,
        buyPressure:  r.buyPressure,
        sellPressure: r.sellPressure,
        volume:       r.volume,
        depth:        r.depth,
        speed:        r.speed,
      })
    }
  } catch (err) {
    console.error('[otc-v2] loadPersistedRuntimeStates failed — defaults will be used', err)
  }
  return out
}

// Periodic snapshot of every asset's regime + liquidity + trendBias.
// Runs every STATE_FLUSH_INTERVAL_MS; cheap (one row per table per
// asset, UPSERTed). Survives `prisma migrate deploy` because nothing
// truncates these tables.
async function flushRuntimeState(): Promise<void> {
  for (const s of assetStates.values()) {
    try {
      await prisma.$executeRaw`
        INSERT INTO otc_market_state
          ("assetId", "currentRegime", "regimeStartedAt", "regimeDurationS",
           "currentDrift", "currentVol", "trendBias", "updatedAt")
        VALUES (
          ${s.config.id},
          ${s.regime}::"OtcRegime",
          ${new Date(s.regimeStartedAt)},
          ${Math.floor(s.regimeDurationMs / 1000)},
          0,
          ${s.config.volatilityBase},
          ${s.trendBias},
          NOW()
        )
        ON CONFLICT ("assetId") DO UPDATE SET
          "currentRegime"   = EXCLUDED."currentRegime",
          "regimeStartedAt" = EXCLUDED."regimeStartedAt",
          "regimeDurationS" = EXCLUDED."regimeDurationS",
          "currentVol"      = EXCLUDED."currentVol",
          "trendBias"       = EXCLUDED."trendBias",
          "updatedAt"       = NOW()
      `
      await prisma.$executeRaw`
        INSERT INTO otc_liquidity_state
          ("assetId", spread, "buyPressure", "sellPressure",
           volume, depth, speed, "updatedAt")
        VALUES (
          ${s.config.id},
          ${s.spread}, ${s.buyPressure}, ${s.sellPressure},
          ${s.volume}, ${s.depth}, ${s.speed},
          NOW()
        )
        ON CONFLICT ("assetId") DO UPDATE SET
          spread         = EXCLUDED.spread,
          "buyPressure"  = EXCLUDED."buyPressure",
          "sellPressure" = EXCLUDED."sellPressure",
          volume         = EXCLUDED.volume,
          depth          = EXCLUDED.depth,
          speed          = EXCLUDED.speed,
          "updatedAt"    = NOW()
      `
    } catch (err) {
      console.error(`[otc-v2] flushRuntimeState failed for ${s.config.id}`, err)
    }
  }
}

// Periodic cleanup: caps storage growth without sacrificing usefulness.
//
// Retention sizing (all numbers > the chart's CANDLES_PER_TF = 3000
// cap, so users always have full scrollback history):
//   5s   → 6 hours   = ~4,320  candles per asset
//   15s  → 1 day     = ~5,760
//   30s  → 2 days    = ~5,760
//   60s  → 7 days    = ~10,080
//   300s → 30 days   = ~8,640
//   ticks → 1 hour                          (ops resolve in seconds-
//                                            minutes; nothing needs
//                                            tick-level data older)
//   admin/engine logs → 30 days             (audit retention)
//
// IMPORTANT: chunked DELETEs (LIMIT 5000 via CTE) so a first-run
// catch-up on millions of accumulated rows doesn't lock the table
// for minutes and starve the connection pool. The previous
// non-chunked version returned auth/login 500s during boot because
// a single DELETE was holding row locks + the pool was saturated.
const PRUNE_CHUNK            = 5_000   // rows per DELETE round-trip
const PRUNE_MAX_BUDGET_MS    = 10_000  // walk away after this much time
// Pulled from the WITH-CTE result; we stop looping when fewer than
// this came back (= the table is now at steady state for this cycle).
async function deleteChunked(
  table:      string,
  whereSql:   string,
  budgetMs:   number,
): Promise<number> {
  const start = Date.now()
  let totalDeleted = 0
  while (Date.now() - start < budgetMs) {
    // CTE with LIMIT — Postgres doesn't allow DELETE ... LIMIT directly.
    // ctid is the physical row pointer, fastest possible match.
    const deleted: number = await prisma.$executeRawUnsafe(`
      WITH victim AS (
        SELECT ctid FROM ${table}
         WHERE ${whereSql}
         LIMIT ${PRUNE_CHUNK}
      )
      DELETE FROM ${table} t
       USING victim v
       WHERE t.ctid = v.ctid
    `)
    totalDeleted += deleted
    if (deleted < PRUNE_CHUNK) break  // drained
    // Tiny breather so the connection pool can serve other queries
    // (auth/login etc.) between batches.
    await new Promise(r => setTimeout(r, 50))
  }
  return totalDeleted
}

async function pruneOldData(): Promise<void> {
  try {
    const t = Date.now()
    const ticks = await deleteChunked(
      'otc_ticks',
      `"recordedAt" < NOW() - INTERVAL '1 hour'`,
      PRUNE_MAX_BUDGET_MS,
    )
    const candles = await deleteChunked(
      'otc_candles',
      `(timeframe = 5    AND "openTime" < NOW() - INTERVAL '6 hours')  OR
       (timeframe = 15   AND "openTime" < NOW() - INTERVAL '1 day')    OR
       (timeframe = 30   AND "openTime" < NOW() - INTERVAL '2 days')   OR
       (timeframe = 60   AND "openTime" < NOW() - INTERVAL '7 days')   OR
       (timeframe = 300  AND "openTime" < NOW() - INTERVAL '30 days')`,
      PRUNE_MAX_BUDGET_MS,
    )
    // Audit logs rarely have anything to prune — single small DELETE.
    await prisma.$executeRaw`
      DELETE FROM otc_admin_logs WHERE "createdAt" < NOW() - INTERVAL '30 days'
    `
    await prisma.$executeRaw`
      DELETE FROM otc_engine_logs WHERE "createdAt" < NOW() - INTERVAL '30 days'
    `
    const ms = Date.now() - t
    if (ticks + candles > 0 || ms > 1000) {
      console.log(`[otc-v2] prune: ticks=${ticks} candles=${candles} in ${ms}ms`)
    }
  } catch (err) {
    console.error('[otc-v2] pruneOldData failed', err)
  }
}

// Periodic sweep: walks every loaded asset and heals BOTH interior
// gaps (missing slot between two existing candles) and trailing gaps
// (between latest persisted candle and now). The previous version only
// looked at the latest candle vs. now — if the engine recovered from
// a brief outage and resumed ticking, new candles got added but the
// missing slot in the middle was invisible to the sweep.
async function sweepAllGaps(): Promise<void> {
  for (const s of assetStates.values()) {
    try {
      for (const tf of OTC_TIMEFRAMES) {
        await detectAndFillGaps(s.config, tf)
      }
    } catch (err) {
      console.error(`[otc-v2] gap sweep failed for ${s.config.id}`, err)
    }
  }
}

// Looks at the last N candles for a (asset, tf), walks them looking
// for consecutive-pair openTime diffs > tfMs (interior gap) or a tail
// where the latest is more than tfMs behind nowSlot (trailing gap).
// Generates calm placeholder candles for any missing slots, inserts
// them, then refreshes the cache so the API serves them immediately.
const GAP_DETECT_WINDOW = 200    // last 200 candles is plenty for live UX
async function detectAndFillGaps(asset: OtcAssetConfig, tf: number): Promise<void> {
  try {
    const tfMs = tf * 1000
    const rows = await prisma.$queryRaw<Array<{ openTime: Date; closePrice: string }>>`
      SELECT "openTime", "closePrice"::text
      FROM otc_candles
      WHERE "assetId" = ${asset.id} AND timeframe = ${tf}
      ORDER BY "openTime" DESC
      LIMIT ${GAP_DETECT_WINDOW}
    `
    if (rows.length === 0) return
    // Sort ascending so we can walk consecutive pairs.
    const sorted = rows.slice().reverse()

    const placeholders: Array<{
      openTime: Date; openPrice: number; highPrice: number;
      lowPrice: number; closePrice: number;
    }> = []
    const maxStep = asset.volatilityBase * 0.5

    // INTERIOR gaps: for each consecutive pair, fill anything missing
    // between them. Walks softly from the earlier candle's close.
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]
      const next = sorted[i + 1]
      const currOpen = curr.openTime.getTime()
      const nextOpen = next.openTime.getTime()
      const expectedNextOpen = currOpen + tfMs
      if (nextOpen <= expectedNextOpen) continue   // no gap

      const missingCount = (nextOpen - expectedNextOpen) / tfMs
      // Cap interior fills at MAX_BACKFILL_SLOTS so a pathologically
      // long gap doesn't choke a single sweep.
      const fillCount = Math.min(MAX_BACKFILL_SLOTS, missingCount)
      let price = Number(curr.closePrice)
      for (let j = 0; j < fillCount; j++) {
        const openTime = new Date(expectedNextOpen + j * tfMs)
        const open  = price
        const change = (Math.random() - 0.5) * 2 * maxStep
        const close = price * (1 + change)
        const high  = Math.max(open, close) * (1 + Math.abs(Math.random()) * maxStep * 0.5)
        const low   = Math.min(open, close) * (1 - Math.abs(Math.random()) * maxStep * 0.5)
        placeholders.push({ openTime, openPrice: open, highPrice: high, lowPrice: low, closePrice: close })
        price = close
      }
    }

    // TRAILING gap: from the very last persisted candle to nowSlot.
    const last = sorted[sorted.length - 1]
    const lastOpen = last.openTime.getTime()
    const nowSlot = Math.floor(Date.now() / tfMs) * tfMs
    const trailingGapMs = nowSlot - lastOpen - tfMs
    if (trailingGapMs > 0) {
      const missingCount = Math.min(MAX_BACKFILL_SLOTS, Math.floor(trailingGapMs / tfMs))
      let price = Number(last.closePrice)
      for (let j = 1; j <= missingCount; j++) {
        const openTime = new Date(lastOpen + j * tfMs)
        const open  = price
        const change = (Math.random() - 0.5) * 2 * maxStep
        const close = price * (1 + change)
        const high  = Math.max(open, close) * (1 + Math.abs(Math.random()) * maxStep * 0.5)
        const low   = Math.min(open, close) * (1 - Math.abs(Math.random()) * maxStep * 0.5)
        placeholders.push({ openTime, openPrice: open, highPrice: high, lowPrice: low, closePrice: close })
        price = close
      }
    }

    if (placeholders.length === 0) return

    // Batched insert (500/batch).
    const BATCH = 500
    for (let i = 0; i < placeholders.length; i += BATCH) {
      const chunk  = placeholders.slice(i, i + BATCH)
      const values = chunk.map(r => Prisma.sql`(
        ${asset.id}, ${tf}, ${r.openTime},
        ${round5(r.openPrice)}, ${round5(r.highPrice)},
        ${round5(r.lowPrice)},  ${round5(r.closePrice)},
        ${Math.max(1, tf * 10)}, ${r.openTime}
      )`)
      await prisma.$executeRaw`
        INSERT INTO otc_candles
          ("assetId", timeframe, "openTime", "openPrice", "highPrice",
           "lowPrice", "closePrice", "tickCount", "finalizedAt")
        VALUES ${Prisma.join(values, ', ')}
        ON CONFLICT ("assetId", timeframe, "openTime") DO NOTHING
      `
    }

    // Inject the new placeholders into the in-memory cache at the right
    // positions so the API serves them immediately (without waiting for
    // a worker restart + re-prime). Cache stays sorted ascending; we
    // splice each placeholder before the candle whose openTime is just
    // after it.
    const cacheKey = `${asset.id}:${tf}`
    const buf = candleCache.get(cacheKey) ?? []
    for (const p of placeholders) {
      const cand: OtcCandle = {
        assetId:    asset.id,
        timeframe:  tf,
        openTime:   p.openTime,
        open:       round5(p.openPrice),
        high:       round5(p.highPrice),
        low:        round5(p.lowPrice),
        close:      round5(p.closePrice),
        tickCount:  Math.max(1, tf * 10),
        finalizedAt: p.openTime,
      }
      const idx = buf.findIndex(c => c.openTime.getTime() > cand.openTime.getTime())
      if (idx === -1) buf.push(cand)
      else            buf.splice(idx, 0, cand)
    }
    // Trim if we overflowed the cap.
    while (buf.length > CANDLES_PER_TF) buf.shift()
    candleCache.set(cacheKey, buf)

    console.log(`[otc-v2] gap sweep: ${asset.id} tf=${tf} filled ${placeholders.length} slots`)
  } catch (err) {
    console.error(`[otc-v2] detectAndFillGaps failed for ${asset.id} tf=${tf}`, err)
  }
}

// After downtime, generate placeholder candles for the slots that
// elapsed between `lastCandle.openTime` and the current slot, walking
// gently from `lastCandle.close`. Without this, the chart shows an
// empty gap (visible blank space between left and right candle
// clusters) for the entire downtime duration.
//
// Bounded to MAX_BACKFILL_SLOTS per timeframe so a long outage (hours)
// doesn't choke the boot with tens of thousands of inserts. Beyond the
// cap, we just leave the gap — the user can scroll past it.
const MAX_BACKFILL_SLOTS = 600   // ~10 min for tf=1s, ~10h for tf=60s
async function backfillMissingCandles(asset: OtcAssetConfig, last60: OtcCandle): Promise<void> {
  for (const tf of OTC_TIMEFRAMES) {
    try {
      const tfMs = tf * 1000
      const nowSlot = Math.floor(Date.now() / tfMs) * tfMs

      // Find the latest stored candle for this specific tf, not just tf=60.
      const rows = await prisma.$queryRaw<Array<{ openTime: Date; closePrice: string }>>`
        SELECT "openTime", "closePrice"::text
        FROM otc_candles
        WHERE "assetId" = ${asset.id} AND timeframe = ${tf}
        ORDER BY "openTime" DESC
        LIMIT 1
      `
      const lastOpen = rows[0]?.openTime?.getTime() ?? (last60.openTime.getTime())
      const lastClose = rows[0] ? Number(rows[0].closePrice) : last60.close

      const gapMs = nowSlot - lastOpen - tfMs
      if (gapMs <= 0) continue
      const missingSlots = Math.min(MAX_BACKFILL_SLOTS, Math.floor(gapMs / tfMs))
      if (missingSlots <= 0) continue

      // Walk softly from lastClose — very small per-candle variance so
      // the downtime stretch looks like a calm holding pattern, not a
      // rally. Bounded by ±0.5% of seed over the whole backfill.
      const maxStep = asset.volatilityBase * 0.5
      let price = lastClose
      const rowsToInsert: Array<{
        openTime: Date; openPrice: number; highPrice: number;
        lowPrice: number; closePrice: number;
      }> = []
      for (let i = 1; i <= missingSlots; i++) {
        const openTime = new Date(lastOpen + i * tfMs)
        const open = price
        const change = (Math.random() - 0.5) * 2 * maxStep
        const close = price * (1 + change)
        const high  = Math.max(open, close) * (1 + Math.abs(Math.random()) * maxStep * 0.5)
        const low   = Math.min(open, close) * (1 - Math.abs(Math.random()) * maxStep * 0.5)
        rowsToInsert.push({ openTime, openPrice: open, highPrice: high, lowPrice: low, closePrice: close })
        price = close
      }

      // Batched insert (500/batch — same cap as bootstrap).
      const BATCH = 500
      for (let i = 0; i < rowsToInsert.length; i += BATCH) {
        const chunk  = rowsToInsert.slice(i, i + BATCH)
        const values = chunk.map(r => Prisma.sql`(
          ${asset.id}, ${tf}, ${r.openTime},
          ${round5(r.openPrice)}, ${round5(r.highPrice)},
          ${round5(r.lowPrice)},  ${round5(r.closePrice)},
          ${Math.max(1, tf * 10)}, ${r.openTime}
        )`)
        await prisma.$executeRaw`
          INSERT INTO otc_candles
            ("assetId", timeframe, "openTime", "openPrice", "highPrice",
             "lowPrice", "closePrice", "tickCount", "finalizedAt")
          VALUES ${Prisma.join(values, ', ')}
          ON CONFLICT ("assetId", timeframe, "openTime") DO NOTHING
        `
      }
      if (rowsToInsert.length > 0) {
        console.log(`[otc-v2] backfilled ${asset.id} tf=${tf}: ${rowsToInsert.length} slots`)
      }
    } catch (err) {
      console.error(`[otc-v2] backfillMissingCandles failed for ${asset.id} tf=${tf}`, err)
    }
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
