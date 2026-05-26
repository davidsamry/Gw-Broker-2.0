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
import {
  otcTicksEmittedTotal, otcCandlesFinalizedTotal,
  otcRegimeTransitionsTotal, otcPriceCurrent,
  otcPendingTicksSize, otcPendingCandlesSize,
  timedDbOp,
} from '../../../metrics/registry.js'

// ── Boot-grace window — suppresses random spikes in the first
// BOOT_SPIKE_GRACE_MS so the first ticks post-restart can't introduce
// a visible discontinuity. ─────────────────────────────────────────────
const BOOT_SPIKE_GRACE_MS = 10_000

// ── M1 candle rules (founder-requested 2026-05-26) ────────────────────
// 1. No more than MAX_M1_SAME_DIRECTION consecutive same-direction
//    M1 candles. When hit, runtime arms a 60s force-reverse window
//    (drift overridden by FORCE_REVERSE_DRIFT_PER_TICK in pricing.ts).
// 2. ≥WICK_TARGET_PROB of M1 candles must have at least one wick.
//    Runtime checks the in-progress M1 near the end of the slot
//    (WICK_INJECT_AFTER_PCT through it) and, if wick-less, pushes
//    the emitted price beyond the body to create one.
const MAX_M1_SAME_DIRECTION = 5
const FORCE_REVERSE_DURATION_MS = 60_000
const WICK_TARGET_PROB        = 0.9
const WICK_INJECT_AFTER_PCT   = 0.85   // inject if 85%+ through the M1
const WICK_MIN_SIZE_PCT       = 0.0005 // 5bp minimum wick
const WICK_BODY_RATIO         = 0.4    // wick = max(40% of body, MIN)
const M1_TIMEFRAME_SEC        = 60

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
    const fromRegime = s.regime
    const transitioned = maybeTransitionRegime(s, now)
    if (transitioned) {
      otcRegimeTransitionsTotal.inc({ assetId, from: fromRegime, to: s.regime })
    }

    let price = stepPrice(s)
    // Track tick freshness for the Fase 3 snapshot.
    s.lastTickAt = now

    // ── Rule 2 — guarantee ≥90% of M1 candles have a wick ──────────
    // Peek at the in-progress M1 builder. If we're past
    // WICK_INJECT_AFTER_PCT through the slot and the candle hasn't yet
    // poked outside its body, push the emitted price beyond the body so
    // the candle finalises with a visible upper or lower shadow.
    // One injection per slot (guarded by m1WickCheckedSlot).
    const m1Builder = (builders.get(assetId) ?? []).find((b) => b.timeframe === M1_TIMEFRAME_SEC)
    const m1Cur     = m1Builder?.getCurrent() ?? null
    if (m1Cur) {
      const slotOpenMs   = m1Cur.openTime.getTime()
      const slotProgress = (now - slotOpenMs) / (M1_TIMEFRAME_SEC * 1000)
      // New slot started — clear the "checked" marker so we can inject again.
      if (slotProgress < 0.05) s.m1WickCheckedSlot = undefined
      if (slotProgress >= WICK_INJECT_AFTER_PCT && s.m1WickCheckedSlot !== slotOpenMs) {
        const bodyHigh     = Math.max(m1Cur.open, m1Cur.close)
        const bodyLow      = Math.min(m1Cur.open, m1Cur.close)
        const hasUpperWick = m1Cur.high > bodyHigh + 1e-9
        const hasLowerWick = m1Cur.low  < bodyLow  - 1e-9
        if (!hasUpperWick && !hasLowerWick && Math.random() < WICK_TARGET_PROB) {
          const bodySize    = Math.abs(m1Cur.close - m1Cur.open)
          const minWick     = m1Cur.close * WICK_MIN_SIZE_PCT
          const wickSize    = Math.max(bodySize * WICK_BODY_RATIO, minWick)
          // Direction: counter to the current body (realistic — wicks
          // typically form on rejection of an extension). For doji
          // (close == open) we default to a lower wick (-1).
          const dir = m1Cur.close >= m1Cur.open ? -1 : 1
          price = m1Cur.open + dir * wickSize
        }
        s.m1WickCheckedSlot = slotOpenMs
      }
    }

    const tick: OtcTick = { assetId: s.config.id, price: round5(price), recordedAt: new Date(now) }
    pendingTicks.push(tick)

    // Fase M3 metrics — these are per-tick (10Hz × 5 assets = 50/sec).
    // Counter.inc and Gauge.set are constant-time, no allocations.
    otcTicksEmittedTotal.inc({ assetId })
    otcPriceCurrent.set({ assetId }, tick.price)

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
        otcCandlesFinalizedTotal.inc({ assetId, timeframe: String(cb.timeframe) })
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

        // ── Rule 1 — cap M1 same-direction streak at MAX_M1_SAME_DIRECTION ──
        // On every M1 finalize, classify direction. If we hit the cap,
        // arm a 60s force-reverse window so the next M1 swings the other
        // way (regardless of regime FSM). Doji resets the streak — neither
        // up nor down — so a 4-up-then-doji-then-up sequence is fine.
        if (cb.timeframe === M1_TIMEFRAME_SEC) {
          const dir: 'UP' | 'DOWN' | null =
            finalized.close > finalized.open ? 'UP'
            : finalized.close < finalized.open ? 'DOWN'
            : null

          if (dir == null) {
            s.m1DirectionStreak = 0
            s.m1LastDirection   = undefined
          } else if (dir === s.m1LastDirection) {
            s.m1DirectionStreak = (s.m1DirectionStreak ?? 1) + 1
            if (s.m1DirectionStreak >= MAX_M1_SAME_DIRECTION) {
              s.forceReverseUntilMs = Date.now() + FORCE_REVERSE_DURATION_MS
              s.forceReverseDir     = dir
              // Reset so the reversal doesn't re-trigger every subsequent
              // candle — let the streak rebuild naturally if the trend
              // resumes after the forced window expires.
              s.m1DirectionStreak = 0
              s.m1LastDirection   = undefined
            }
          } else {
            s.m1DirectionStreak = 1
            s.m1LastDirection   = dir
          }
        }
      }
    }
  }, period)

  tickIntervals.push(id)
}

// ── Periodic flush of pending ticks + candles to DB ────────────────────
export async function flushPending(): Promise<void> {
  // Update queue-depth gauges before snapshotting so a Prometheus scrape
  // landing mid-flush still sees the pre-flush depth.
  otcPendingTicksSize.set(pendingTicks.length)
  otcPendingCandlesSize.set(pendingCandles.length)

  // Snapshot + clear (concurrent ticks during the await are picked up
  // on the next flush — they're already in cache for serving).
  const ticks   = pendingTicks.splice(0)
  const candles = pendingCandles.splice(0)
  if (ticks.length > 0) {
    try { await timedDbOp('flush_ticks', () => flushTicksBatch(ticks)) }
    catch (err) { console.error('[otc-v2] tick flush failed', err) }
  }
  if (candles.length > 0) {
    try { await timedDbOp('flush_candles', () => flushCandlesBatch(candles)) }
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
