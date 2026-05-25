// Fase 4 — interval coordination. Owns the per-asset tick loop +
// shared periodic loops (flush / liquidity / state / gap sweep). The
// boot module starts them; the shutdown module stops them.

import type { OtcTick } from '../types.js'
import { ENGINE_TICK_INTERVAL_MS, CANDLES_PER_TF } from '../types.js'
import { maybeTransitionRegime, stepLiquidity, stepPrice } from '../engine/pricing.js'
import { publishTick, publishCandle } from '../stream/bus.js'
import {
  assetStates, builders, candleCache,
  pendingTicks, pendingCandles, round5, getBootedAt,
} from './state-map.js'
import { flushTicksBatch } from '../storage/ticks.js'
import { flushCandlesBatch } from '../storage/candles.js'

// ── Boot-grace window — suppresses random spikes in the first
// BOOT_SPIKE_GRACE_MS so the first ticks post-restart can't introduce
// a visible discontinuity. ─────────────────────────────────────────────
const BOOT_SPIKE_GRACE_MS = 10_000

export function msSinceBoot(): number {
  const bootedAt = getBootedAt()
  return bootedAt === 0 ? Number.MAX_SAFE_INTEGER : Date.now() - bootedAt
}

export function isWithinBootGrace(): boolean {
  return msSinceBoot() < BOOT_SPIKE_GRACE_MS
}

// ── Interval handles — exported so shutdown can clear them all ─────────
export const tickIntervals: Array<ReturnType<typeof setInterval>> = []
export const intervals = {
  flush:        null as ReturnType<typeof setInterval> | null,
  liquidity:    null as ReturnType<typeof setInterval> | null,
  stateFlush:   null as ReturnType<typeof setInterval> | null,
  gapSweep:     null as ReturnType<typeof setInterval> | null,
  prune:        null as ReturnType<typeof setInterval> | null,
}

// ── Per-asset tick loop ────────────────────────────────────────────────
export function startAssetLoop(assetId: string): void {
  const state = assetStates.get(assetId)
  if (!state) return
  const period = Math.max(50, Math.round(ENGINE_TICK_INTERVAL_MS / Math.max(0.1, state.config.speedMultiplier)))

  const id = setInterval(() => {
    const s = assetStates.get(assetId)
    if (!s || !s.config.enabled || s.config.paused) return

    const now = Date.now()
    // Tag the boot grace window so stepPrice skips its spike branch.
    s.bootGrace = isWithinBootGrace()
    maybeTransitionRegime(s, now)

    const price = stepPrice(s)
    // Track tick freshness for the Fase 3 snapshot.
    s.lastTickAt = now
    const tick: OtcTick = { assetId: s.config.id, price: round5(price), recordedAt: new Date(now) }
    pendingTicks.push(tick)

    publishTick({ assetId: tick.assetId, price: tick.price, time: now })

    const cbs = builders.get(assetId) ?? []
    for (const cb of cbs) {
      const { current, finalized } = cb.onTick(tick.price, now)
      // Update cache — replace last (current) entry if it shares openTime.
      const cacheKey = `${assetId}:${cb.timeframe}`
      const buf = candleCache.get(cacheKey) ?? []
      const last = buf[buf.length - 1]
      if (last && last.openTime.getTime() === current.openTime.getTime()) {
        buf[buf.length - 1] = current
      } else {
        buf.push(current)
        if (buf.length > CANDLES_PER_TF) buf.shift()
      }
      candleCache.set(cacheKey, buf)

      publishCandle({
        assetId, timeframe: cb.timeframe,
        openTime: current.openTime.getTime(),
        open: current.open, high: current.high, low: current.low, close: current.close,
        isClosed: false,
      })

      if (finalized) {
        pendingCandles.push(finalized)
        // Track the most-recent finalized candle's openTime for the snapshot.
        const finOpen = finalized.openTime.getTime()
        if (!s.lastCandleAt || finOpen > s.lastCandleAt) {
          s.lastCandleAt = finOpen
        }
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

// ── Periodic flush of pending ticks + candles to DB ────────────────────
export async function flushPending(): Promise<void> {
  // Snapshot + clear (concurrent ticks during the await are picked up
  // on the next flush — they're already in cache for serving).
  const ticks   = pendingTicks.splice(0)
  const candles = pendingCandles.splice(0)
  if (ticks.length > 0) {
    try { await flushTicksBatch(ticks) }
    catch (err) { console.error('[otc-v2] tick flush failed', err) }
  }
  if (candles.length > 0) {
    try { await flushCandlesBatch(candles) }
    catch (err) { console.error('[otc-v2] candle flush failed', err) }
  }
}

// Liquidity step — called every LIQUIDITY_UPDATE_INTERVAL_MS.
export function stepAllLiquidity(): void {
  for (const state of assetStates.values()) {
    if (state.config.paused) continue
    stepLiquidity(state)
  }
}
