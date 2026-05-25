// Fase 4 — legacy otc_market_state + otc_liquidity_state I/O.
// Kept for back-compat (Fase 3 snapshot is the primary source now);
// these stay populated by the same 5s loop until a future cleanup.

import { prisma } from '../../../prisma.js'
import type { OtcRegime } from '../types.js'
import { assetStates } from '../runtime/state-map.js'

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

// Periodic snapshot of every asset's regime + liquidity + trendBias
// to the LEGACY tables. The Fase 3 snapshot table is primary now;
// these stay populated for back-compat until a future cleanup.
export async function flushRuntimeState(): Promise<void> {
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
