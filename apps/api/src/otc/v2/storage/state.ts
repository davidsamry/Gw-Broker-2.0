// Fase M1 (May 2026): legacy otc_market_state + otc_liquidity_state
// are no longer written by the engine. The Fase 3 otc_engine_snapshot
// table is the single source of truth — it has everything these
// legacy tables had + more (FSM duration in ms instead of s, smoothed
// price, last tick/candle timestamps).
//
// Write path removed because the 5s flush loop was doing 10 round-
// trips (2 per asset × 5 assets) on top of the snapshot flush —
// pure overhead with no consumer. Read path kept as a defensive
// fallback for buildInitialState in case otc_engine_snapshot is
// missing rows (e.g., new asset added live without snapshot yet).
//
// Tables themselves stay (no destructive drop) so any old admin tool
// that reads them still works. They become read-only fossils. A
// future migration can drop them once we're certain nothing else
// reads from them.

import { prisma } from '../../../prisma.js'
import type { OtcRegime } from '../types.js'

// What we read out of otc_market_state + otc_liquidity_state at boot.
// All fields optional because either table might be missing rows for a
// brand-new asset.
export interface PersistedRuntimeState {
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

export async function loadPersistedRuntimeStates(assetIds: string[]): Promise<Map<string, PersistedRuntimeState>> {
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
