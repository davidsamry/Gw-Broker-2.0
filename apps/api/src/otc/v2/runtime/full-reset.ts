// Full engine reset — wipes in-memory state for every loaded asset so the
// next tick starts from configured seedPrice. Sister to resetAssetState()
// but scoped to the whole engine in one shot.
//
// Use case: admin observes that prices have drifted far from seed (e.g.
// after multiple dev instances raced on the same DB and corrupted the
// snapshot), wants to snap everything back without restarting the API.
//
// This function ONLY touches in-process state. The caller is responsible
// for the DB-side wipe (candles / ticks / snapshot / market_state /
// liquidity_state) — see admin/otc/service.ts fullResetAllOtc.

import { CandleBuilder } from '../engine/candle-builder.js'
import { OTC_TIMEFRAMES, BACKFILL_AFTER_RESET } from '../types.js'
import { pickRegimeDurationMs } from '../engine/pricing.js'
import { resetMicroState } from '../engine/microdynamics.js'
import { assetStates, builders, candleCache, pendingTicks, pendingCandles } from './state-map.js'

export interface FullResetSummary {
  assetsReset:    number
  buildersReset:  number
  cacheCleared:   number
  pendingDropped: number
}

export function fullResetEngine(): FullResetSummary {
  let assetsReset = 0
  let buildersReset = 0

  for (const [id, s] of assetStates) {
    // Snap macro state to seed + LATERAL.
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
    // Clear M1-rule + force-reverse state so streak counters don't carry over.
    s.m1DirectionStreak    = 0
    s.m1LastDirection      = undefined
    s.m1WickCheckedSlot    = undefined
    s.forceReverseUntilMs  = undefined
    s.forceReverseDir      = undefined
    s.forceNextCandleDir   = undefined
    s.pullbackTicksRemaining = 0
    s.lastTickAt           = undefined
    s.lastCandleAt         = undefined
    // Arm the post-reset backfill — the next tick on the asset loop
    // will capture the live open price and inject BACKFILL_AFTER_RESET
    // flat candles per timeframe immediately before the current slot,
    // giving the chart visual context instead of starting empty.
    s.pendingBackfillCount = BACKFILL_AFTER_RESET
    assetsReset++

    // Replace builders so the next tick opens a fresh candle at seedPrice
    // instead of carrying forward the corrupted last close from the
    // previous slot.
    const fresh = OTC_TIMEFRAMES.map(tf => {
      const cb = new CandleBuilder(id, tf)
      cb.seedFromCandle(null)   // null = no prior state
      return cb
    })
    builders.set(id, fresh)
    buildersReset += fresh.length

    // Wipe the micro-layer AR(1) jitter + sub-regime so it doesn't carry
    // burst momentum into the freshly-seeded price.
    resetMicroState(id)
  }

  const cacheCleared = candleCache.size
  candleCache.clear()

  const pendingDropped = pendingTicks.length + pendingCandles.length
  pendingTicks.length   = 0
  pendingCandles.length = 0

  return { assetsReset, buildersReset, cacheCleared, pendingDropped }
}
