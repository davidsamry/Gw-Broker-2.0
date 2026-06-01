// Fase 4 — otc_engine_snapshot I/O. Atomic engine state per asset,
// UPSERTed every 5s + on shutdown. Loaded as PRIMARY recovery source.

import { Prisma } from '@prisma/client'
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
  // 2026-06-01: M1 streak state persistido pra sobreviver restart.
  m1DirectionStreak:    number
  m1LastDirection:      'UP' | 'DOWN' | null
  forceReverseUntilAt:  Date | null
  forceReverseDir:      'UP' | 'DOWN' | null
  forceNextCandleDir:   'UP' | 'DOWN' | null
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
      m1DirectionStreak: number;
      m1LastDirection: string | null;
      forceReverseUntilAt: Date | null;
      forceReverseDir: string | null;
      forceNextCandleDir: string | null;
      updatedAt: Date;
    }>>`
      SELECT
        "assetId", "snapshotVersion",
        "currentPrice"::text, "smoothedPrice"::text,
        regime, "regimeStartedAt", "regimeDurationMs",
        spread, "buyPressure", "sellPressure",
        volume, depth, speed, "trendBias",
        "lastTickTime", "lastCandleTime",
        "m1DirectionStreak", "m1LastDirection",
        "forceReverseUntilAt", "forceReverseDir", "forceNextCandleDir",
        "updatedAt"
      FROM otc_engine_snapshot
      WHERE "assetId" = ANY(${assetIds}::text[])
    `
    for (const r of rows) {
      const m1Last  = r.m1LastDirection      === 'UP' || r.m1LastDirection      === 'DOWN' ? r.m1LastDirection      : null
      const frDir   = r.forceReverseDir      === 'UP' || r.forceReverseDir      === 'DOWN' ? r.forceReverseDir      : null
      const fncDir  = r.forceNextCandleDir   === 'UP' || r.forceNextCandleDir   === 'DOWN' ? r.forceNextCandleDir   : null
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
        m1DirectionStreak:    r.m1DirectionStreak ?? 0,
        m1LastDirection:      m1Last,
        forceReverseUntilAt:  r.forceReverseUntilAt,
        forceReverseDir:      frDir,
        forceNextCandleDir:   fncDir,
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

// UPSERT every active asset in ONE query. Called every 5s + on shutdown.
//
// Was N round-trips (one INSERT per asset) — with the 5-asset launch
// catalog that's 5 connections held briefly every 5s. Combined with the
// (now-deleted) flushRuntimeState it was 15 round-trips per cycle,
// which on a 3-connection pool meant the snapshot flush regularly
// stalled tick flushes waiting for a connection. Now: one batched
// INSERT with VALUES (...), (...), ... and the same ON CONFLICT clause.
//
// If asset count ever grows past ~50, switch to chunked batches (PG
// parameter limit is 65k; one row uses 17 params here).
export async function flushSnapshot(): Promise<void> {
  const states = Array.from(assetStates.values())
  if (states.length === 0) return
  try {
    const values = states.map(s => Prisma.sql`(
      ${s.config.id}, ${CURRENT_SNAPSHOT_VERSION},
      ${s.price}, ${s.smoothedPrice},
      ${s.regime}::"OtcRegime",
      ${new Date(s.regimeStartedAt)},
      ${Math.floor(s.regimeDurationMs)},
      ${s.spread}, ${s.buyPressure}, ${s.sellPressure},
      ${s.volume}, ${s.depth}, ${s.speed}, ${s.trendBias},
      ${s.lastTickAt ? new Date(s.lastTickAt) : null},
      ${s.lastCandleAt ? new Date(s.lastCandleAt) : null},
      ${s.m1DirectionStreak ?? 0},
      ${s.m1LastDirection ?? null},
      ${s.forceReverseUntilMs ? new Date(s.forceReverseUntilMs) : null},
      ${s.forceReverseDir ?? null},
      ${s.forceNextCandleDir ?? null},
      NOW()
    )`)
    await prisma.$executeRaw`
      INSERT INTO otc_engine_snapshot (
        "assetId", "snapshotVersion",
        "currentPrice", "smoothedPrice",
        regime, "regimeStartedAt", "regimeDurationMs",
        spread, "buyPressure", "sellPressure",
        volume, depth, speed, "trendBias",
        "lastTickTime", "lastCandleTime",
        "m1DirectionStreak", "m1LastDirection",
        "forceReverseUntilAt", "forceReverseDir", "forceNextCandleDir",
        "updatedAt"
      ) VALUES ${Prisma.join(values, ', ')}
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
        "m1DirectionStreak"   = EXCLUDED."m1DirectionStreak",
        "m1LastDirection"     = EXCLUDED."m1LastDirection",
        "forceReverseUntilAt" = EXCLUDED."forceReverseUntilAt",
        "forceReverseDir"     = EXCLUDED."forceReverseDir",
        "forceNextCandleDir"  = EXCLUDED."forceNextCandleDir",
        "updatedAt"        = NOW()
    `
  } catch (err) {
    console.error('[otc-v2] flushSnapshot batch failed', err)
  }
}
