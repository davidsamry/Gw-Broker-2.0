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
export async function startOtcV2Worker(): Promise<void> {
  if (isRunning) return
  isRunning = true

  console.log('[otc-v2] booting…')
  try {
    const configs = await loadAssetConfigs()
    if (configs.length === 0) {
      console.warn('[otc-v2] no assets in otc_assets — nothing to drive')
      isRunning = false
      return
    }

    // 1. Bootstrap historical candles (first deploy only — idempotent)
    await bootstrapHistoricalCandles(configs)

    // 2. Hydrate in-memory state from DB
    const latestCandles = await loadLatestCandlePerTimeframe(configs.map(c => c.id))
    for (const cfg of configs) {
      assetStates.set(cfg.id, buildInitialState(cfg, latestCandles))

      // Build candle builders + seed from last candle
      const cbs: CandleBuilder[] = []
      for (const tf of OTC_TIMEFRAMES) {
        const cb = new CandleBuilder(cfg.id, tf)
        cb.seedFromCandle(latestCandles.get(`${cfg.id}:${tf}`) ?? null)
        cbs.push(cb)
      }
      builders.set(cfg.id, cbs)

      // Preload last CANDLES_PER_TF rows into the cache for fast reads
      await primeCandleCache(cfg.id)
    }

    // 3. Start one tick interval per asset (own cadence via speedMultiplier)
    for (const cfg of configs) {
      startAssetLoop(cfg.id)
    }

    // 4. Start the periodic flush + liquidity loops
    flushInterval = setInterval(flushPending, TICK_FLUSH_INTERVAL_MS)
    liquidityInterval = setInterval(() => {
      for (const state of assetStates.values()) {
        if (state.config.paused) continue
        stepLiquidity(state)
      }
    }, LIQUIDITY_UPDATE_INTERVAL_MS)

    console.log(`[otc-v2] running with ${configs.length} assets, ${OTC_TIMEFRAMES.length} timeframes`)
  } catch (err) {
    console.error('[otc-v2] boot failed', err)
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
      await prisma.$executeRaw`
        INSERT INTO otc_candles
          ("assetId", timeframe, "openTime", "openPrice", "highPrice", "lowPrice", "closePrice", "tickCount", "finalizedAt")
        VALUES ${Prisma.join(values, ', ')}
        ON CONFLICT ("assetId", timeframe, "openTime")
        DO UPDATE SET
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
