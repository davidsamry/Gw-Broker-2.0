// Fase 4 — admin-facing snapshot of an asset's live in-memory state +
// in-mem mutators (trendBias, reset). Powers the /admin/otc/* routes.

import type { OtcAssetState, OtcRegime } from '../types.js'
import { pickRegimeDurationMs } from '../engine/pricing.js'
import { assetStates, round5 } from '../runtime/state-map.js'

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
  // Fase 9 — freshness markers for admin card. Updated by the tick
  // loop (Fase 3 snapshot integration). null when the engine has
  // never ticked this asset (rare — only between boot and the first
  // tick).
  lastTickAt:       number | null   // epoch ms of last tick processed
  lastCandleAt:     number | null   // epoch ms of openTime of most recent
                                    // FINALIZED candle (any tf)
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
    lastTickAt:       s.lastTickAt   ?? null,
    lastCandleAt:     s.lastCandleAt ?? null,
  }
}

export function getAssetLiveState(assetId: string): OtcAssetLiveState | null {
  const s = assetStates.get(assetId)
  return s ? snapshotLiveState(s) : null
}

export function listAssetLiveStates(): OtcAssetLiveState[] {
  return Array.from(assetStates.values()).map(snapshotLiveState)
}

// Admin nudges the regime drift in a direction without forcing a
// specific regime. Clamped to [-1, +1]; multiplied by 0.000005 in
// stepPrice so a max bias adds ~0.3%/min — strong enough to skew
// direction over minutes without overwhelming the regime FSM.
export function setAssetTrendBias(assetId: string, bias: number): boolean {
  const s = assetStates.get(assetId)
  if (!s) return false
  s.trendBias = Math.max(-1, Math.min(1, bias))
  return true
}

// Snap price + regime + liquidity back to baseline. Used when admin
// sees the chart drift into a weird state and wants a clean reset
// without restarting the API process. Does NOT touch finalized
// candles — the audit trail of what users actually saw stays intact;
// the next live candle just opens at seedPrice.
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
