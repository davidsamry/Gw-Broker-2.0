// Fase 4 — otc_engine_snapshot I/O. Atomic engine state per asset,
// UPSERTed every 5s + on shutdown. Loaded as PRIMARY recovery source.

import { prisma } from '../../../prisma.js'
import type { OtcRegime } from '../types.js'
import { assetStates } from '../runtime/state-map.js'

export const CURRENT_SNAPSHOT_VERSION = 1
// Snapshots older than this are considered stale and ignored. Engine
// was off too long; tick/candle history is a better source of truth
// for the post-restart starting price than a regime that's been
// "running" with no actual ticks for hours.
export const SNAPSHOT_MAX_AGE_MS = 30 * 60_000   // 30 min

export interface EngineSnapshot {
  assetId:          string
  snapshotVersion:  number
  currentPrice:     number
  smoothedPrice:    number
  regime:           OtcRegime
  regimeStartedAt:  Date
  regimeDurationMs: number
  spread:           number
  buyPressure:      number
  sellPressure:     number
  volume:           number
  depth:            number
  speed:            number
  trendBias:        number
  lastTickTime:     Date | null
  lastCandleTime:   Date | null
  updatedAt:        Date
}

// Load all snapshots in one round-trip on boot.
export async function loadSnapshots(assetIds: string[]): Promise<Map<string, EngineSnapshot | null>> {
  const out = new Map<string, EngineSnapshot | null>()
  for (const id of assetIds) out.set(id, null)
  if (assetIds.length === 0) return out
  try {
    const rows = await prisma.$queryRaw<Array<{
      assetId: string; snapshotVersion: number;
      currentPrice: string; smoothedPrice: string;
      regime: OtcRegime; regimeStartedAt: Date; regimeDurationMs: number;
      spread: number; buyPressure: number; sellPressure: number;
      volume: number; depth: number; speed: number; trendBias: number;
      lastTickTime: Date | null; lastCandleTime: Date | null;
      updatedAt: Date;
    }>>`
      SELECT
        "assetId", "snapshotVersion",
        "currentPrice"::text, "smoothedPrice"::text,
        regime, "regimeStartedAt", "regimeDurationMs",
        spread, "buyPressure", "sellPressure",
        volume, depth, speed, "trendBias",
        "lastTickTime", "lastCandleTime", "updatedAt"
      FROM otc_engine_snapshot
      WHERE "assetId" = ANY(${assetIds}::text[])
    `
    for (const r of rows) {
      out.set(r.assetId, {
        assetId:          r.assetId,
        snapshotVersion:  r.snapshotVersion,
        currentPrice:     Number(r.currentPrice),
        smoothedPrice:    Number(r.smoothedPrice),
        regime:           r.regime,
        regimeStartedAt:  r.regimeStartedAt,
        regimeDurationMs: r.regimeDurationMs,
        spread:           r.spread,
        buyPressure:      r.buyPressure,
        sellPressure:     r.sellPressure,
        volume:           r.volume,
        depth:            r.depth,
        speed:            r.speed,
        trendBias:        r.trendBias,
        lastTickTime:     r.lastTickTime,
        lastCandleTime:   r.lastCandleTime,
        updatedAt:        r.updatedAt,
      })
    }
  } catch (err) {
    // Table missing (migration didn't run) is the most likely cause.
    // The fall-through chain handles absence gracefully.
    console.error('[otc-v2] loadSnapshots failed — snapshot recovery disabled this cycle', err)
  }
  return out
}

// UPSERT one row per asset. Called every 5s + on shutdown.
export async function flushSnapshot(): Promise<void> {
  for (const s of assetStates.values()) {
    try {
      await prisma.$executeRaw`
        INSERT INTO otc_engine_snapshot (
          "assetId", "snapshotVersion",
          "currentPrice", "smoothedPrice",
          regime, "regimeStartedAt", "regimeDurationMs",
          spread, "buyPressure", "sellPressure",
          volume, depth, speed, "trendBias",
          "lastTickTime", "lastCandleTime", "updatedAt"
        ) VALUES (
          ${s.config.id}, ${CURRENT_SNAPSHOT_VERSION},
          ${s.price}, ${s.smoothedPrice},
          ${s.regime}::"OtcRegime",
          ${new Date(s.regimeStartedAt)},
          ${Math.floor(s.regimeDurationMs)},
          ${s.spread}, ${s.buyPressure}, ${s.sellPressure},
          ${s.volume}, ${s.depth}, ${s.speed}, ${s.trendBias},
          ${s.lastTickAt ? new Date(s.lastTickAt) : null},
          ${s.lastCandleAt ? new Date(s.lastCandleAt) : null},
          NOW()
        )
        ON CONFLICT ("assetId") DO UPDATE SET
          "snapshotVersion"  = EXCLUDED."snapshotVersion",
          "currentPrice"     = EXCLUDED."currentPrice",
          "smoothedPrice"    = EXCLUDED."smoothedPrice",
          regime             = EXCLUDED.regime,
          "regimeStartedAt"  = EXCLUDED."regimeStartedAt",
          "regimeDurationMs" = EXCLUDED."regimeDurationMs",
          spread             = EXCLUDED.spread,
          "buyPressure"      = EXCLUDED."buyPressure",
          "sellPressure"     = EXCLUDED."sellPressure",
          volume             = EXCLUDED.volume,
          depth              = EXCLUDED.depth,
          speed              = EXCLUDED.speed,
          "trendBias"        = EXCLUDED."trendBias",
          "lastTickTime"     = EXCLUDED."lastTickTime",
          "lastCandleTime"   = EXCLUDED."lastCandleTime",
          "updatedAt"        = NOW()
      `
    } catch (err) {
      console.error(`[otc-v2] flushSnapshot failed for ${s.config.id}`, err)
    }
  }
}
