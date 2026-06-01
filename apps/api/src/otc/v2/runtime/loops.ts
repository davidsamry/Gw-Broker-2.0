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
import { maybeManipulatePrice, isSlotUnderManipulation, getSignalsForAsset } from './manipulation.js'
import { injectBackwardsHistory } from './post-reset-backfill.js'

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

    // ── Admin manipulation (Cadastro OTC) ─────────────────────────
    // Nudges price toward the admin-configured direction in the final
    // seconds of a targeted M1 slot. Surgical — outside the window,
    // outside a signal's slot, or with master OFF, this is a no-op.
    // Peek at the in-progress M1 builder to get open/close prices.
    const mBuilder = (builders.get(assetId) ?? []).find((b) => b.timeframe === M1_TIMEFRAME_SEC)
    const mCur     = mBuilder?.getCurrent()
    if (mCur) {
      const nudged = maybeManipulatePrice(
        assetId,
        mCur.openTime.getTime(),
        mCur.open,
        mCur.close,
        M1_TIMEFRAME_SEC,
        now,
        price,
      )
      // If the nudge actually moved the price, also sync the engine's
      // internal state to the nudged value. Without this, the engine's
      // smoothedPrice keeps evolving naturally during the window, then
      // when manipulation ends the next tick snaps back to the engine's
      // internal state — a visible gap on the chart. Pulling the
      // internal state along behind the emitted value keeps continuity
      // through the slot boundary.
      if (nudged !== price) {
        s.price         = nudged
        s.smoothedPrice = nudged
      }
      price = nudged
    }

    // ── Rule 2 — guarantee ≥90% of M1 candles have a wick ──────────
    // Peek at the in-progress M1 builder. If we're past
    // WICK_INJECT_AFTER_PCT through the slot and the candle hasn't yet
    // poked outside its body, push the emitted price beyond the body so
    // the candle finalises with a visible upper or lower shadow.
    // One injection per slot (guarded by m1WickCheckedSlot).
    //
    // SKIPS when the slot is under admin manipulation — wick injection
    // would push counter-body, overwriting the manipulation tick and
    // creating a visible gap on the chart. The manipulation already
    // produces enough body movement to be visible.
    const m1Builder = (builders.get(assetId) ?? []).find((b) => b.timeframe === M1_TIMEFRAME_SEC)
    const m1Cur     = m1Builder?.getCurrent() ?? null
    if (m1Cur) {
      const slotOpenMs   = m1Cur.openTime.getTime()
      const slotProgress = (now - slotOpenMs) / (M1_TIMEFRAME_SEC * 1000)
      const underManipulation = isSlotUnderManipulation(assetId, slotOpenMs, M1_TIMEFRAME_SEC)
      // New slot started — clear the "checked" marker so we can inject again.
      if (slotProgress < 0.05) s.m1WickCheckedSlot = undefined
      if (!underManipulation && slotProgress >= WICK_INJECT_AFTER_PCT && s.m1WickCheckedSlot !== slotOpenMs) {
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

    // ── Post-reset history backfill ────────────────────────────────
    // Set by fullResetEngine to BACKFILL_AFTER_RESET; this is the
    // first tick after a full reset, so we now know the actual open
    // price (close to seedPrice, but not identical — AR(1) jitter).
    // Inject flat historicals per timeframe immediately before the
    // current slot. Fire-and-forget — the tick loop continues so the
    // chart keeps streaming live ticks while the DB write happens.
    if (s.pendingBackfillCount && s.pendingBackfillCount > 0) {
      const count = s.pendingBackfillCount
      s.pendingBackfillCount = 0   // clear FIRST to avoid double-fire on race
      injectBackwardsHistory(assetId, tick.price, count, now, s.config.volatilityBase)
        .catch((err) => {
          console.error('[otc-v2] post-reset backfill failed', { assetId, err })
        })
    }

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
        // ── HARD-FORCE de direcao na vela M1 finalizada ──────────────────
        // 2026-06-01: quando o streak de 5 velas iguais bate o cap, o
        // runtime arma forceNextCandleDir. O drift contrario (force-reverse)
        // tenta puxar a vela pra direcao oposta durante os 60s, mas pode
        // falhar se houver shock dominante. Como ultimo recurso, manipulamos
        // o close DIRETAMENTE aqui — garantia deterministica de que a 6a
        // vela NUNCA fecha igual aos 5 anteriores. So' aplica em M1
        // (timeframe=60s); velas menores (5s/15s/30s) ticam natural.
        if (
          cb.timeframe === M1_TIMEFRAME_SEC &&
          s.forceNextCandleDir
        ) {
          // Re-check liquidity: signal pode ter entrado APOS o force-reverse
          // ser armado (user com liquidityMode operou no meio do slot).
          // Nesse caso, abdica do hard-force pra preservar a coerencia visual
          // da op do user.
          const liqSignalsInSlot = getSignalsForAsset(assetId)
            .filter(sig => sig.id.startsWith('liquidity:'))
          if (liqSignalsInSlot.length > 0) {
            // Liquidez ganha — limpa a flag e nao manipula.
            s.forceNextCandleDir = undefined
          } else {
          const wantUp   = s.forceNextCandleDir === 'UP'
          const wantDown = s.forceNextCandleDir === 'DOWN'
          const actualUp = finalized.close > finalized.open
          const actualDn = finalized.close < finalized.open
          const wrongDir =
            (wantUp   && !actualUp)   ||  // pediu UP mas fechou DOWN ou doji
            (wantDown && !actualDn)       // pediu DOWN mas fechou UP ou doji

          if (wrongDir) {
            // Force o close pra ficar visivelmente do lado certo do open.
            // Magnitude: 0.05% do open — pequeno o suficiente pra nao
            // parecer um spike artificial, grande o suficiente pra
            // produzir um corpo de vela claro.
            const NUDGE_PCT = 0.0005
            const newClose = wantUp
              ? finalized.open * (1 + NUDGE_PCT)
              : finalized.open * (1 - NUDGE_PCT)
            // Preserva consistencia OHLC: high >= max(open, close), low <= min(open, close).
            const newHigh = Math.max(finalized.high, newClose, finalized.open)
            const newLow  = Math.min(finalized.low,  newClose, finalized.open)
            finalized.close = newClose
            finalized.high  = newHigh
            finalized.low   = newLow
            // Sync com o preco runtime — proxima vela abre proximo do close
            // manipulado, evitando "gap" visual entre velas.
            s.price         = newClose
            s.smoothedPrice = newClose
            console.log(`[m1-rule] hard-force ${s.forceNextCandleDir} on ${assetId} (was ${actualUp ? 'UP' : actualDn ? 'DOWN' : 'DOJI'})`)
          }
          // Consome a flag — a proxima vela e' livre.
          s.forceNextCandleDir = undefined
          } // fecha else (sem liquidity signal)
        }

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
              // 2026-06-01: NAO zerar o counter aqui (era o bug que
              // permitia 6+ velas seguidas iguais). Antes: counter
              // zerava ao armar force-reverse e, se a vela 6 ainda
              // fechasse na mesma direcao (drift insuficiente, shock
              // grande), o counter recomecava do 1 — usuario via 10+
              // velas iguais ate' o proximo trigger. Agora: counter
              // continua aumentando, force-reverse e' re-armado a cada
              // vela ate' UMA vela na direcao oposta finalmente fechar.
              //
              // PRIORIDADE LIQUIDEZ: se ha LiquiditySignal ativa pro
              // asset (user com liquidityMode operando nesse momento),
              // a regra das 5 NAO arma. A liquidez por user e' o motor
              // core do negocio e tem que controlar a vela sem
              // interferencia. Resultado: pode aparecer >5 velas iguais
              // em raras coincidencias (user com liquidez + streak),
              // mas a coerencia visual da op do user e' preservada.
              const liqSignals = getSignalsForAsset(assetId)
                .filter(sig => sig.id.startsWith('liquidity:'))
              if (liqSignals.length === 0) {
                s.forceReverseUntilMs = Date.now() + FORCE_REVERSE_DURATION_MS
                s.forceReverseDir     = dir
                // Hard-force flag — manipulation.ts vai forcar o close
                // da proxima vela M1 na direcao oposta (nao confia so'
                // no drift estatistico, que pode ser dominado por shocks).
                s.forceNextCandleDir = dir === 'UP' ? 'DOWN' : 'UP'
              }
            }
          } else {
            s.m1DirectionStreak = 1
            s.m1LastDirection   = dir
            // Force-reverse e' "consumido" — a vela oposta finalmente
            // fechou. Limpa pra evitar override duplo no proximo ciclo.
            s.forceNextCandleDir = undefined
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
