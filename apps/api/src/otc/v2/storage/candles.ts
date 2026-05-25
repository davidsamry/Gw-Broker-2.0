// Fase 4 — otc_candles I/O. Reads (loadLatest, prime) +
// flush (UPSERT all-OHLC ON CONFLICT).

import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma.js'
import type { OtcCandle } from '../types.js'
import { CANDLES_PER_TF, OTC_TIMEFRAMES } from '../types.js'
import { candleCache } from '../runtime/state-map.js'

/** Load the most recent candle per (asset, tf) — used by runtime to
 * seed builders + decide the start-price chain (Fase 2/3). */
export async function loadLatestCandlePerTimeframe(
  assetIds: string[],
): Promise<Map<string, OtcCandle | null>> {
  const map = new Map<string, OtcCandle | null>()
  for (const assetId of assetIds) {
    for (const tf of OTC_TIMEFRAMES) {
      const rows = await prisma.$queryRaw<Array<{
        openTime:   Date
        openPrice:  string
        highPrice:  string
        lowPrice:   string
        closePrice: string
        tickCount:  number
        finalizedAt: Date | null
      }>>`
        SELECT "openTime", "openPrice"::text, "highPrice"::text, "lowPrice"::text, "closePrice"::text, "tickCount", "finalizedAt"
        FROM otc_candles
        WHERE "assetId" = ${assetId} AND timeframe = ${tf}
        ORDER BY "openTime" DESC
        LIMIT 1
      `
      const r = rows[0]
      map.set(`${assetId}:${tf}`, r ? {
        assetId,
        timeframe:   tf,
        openTime:    r.openTime,
        open:        Number(r.openPrice),
        high:        Number(r.highPrice),
        low:         Number(r.lowPrice),
        close:       Number(r.closePrice),
        tickCount:   r.tickCount,
        finalizedAt: r.finalizedAt,
      } : null)
    }
  }
  return map
}

// Populates the candleCache ring buffer for a single asset (one tf at
// a time). Called at boot AFTER backfill so the cache reflects the
// healed history. Mutates the shared Map in state-map.ts.
export async function primeCandleCache(assetId: string): Promise<void> {
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

// UPSERT a batch of finalized candles. ON CONFLICT updates ALL OHLC
// including openPrice — keeps the worker's current finalized state as
// the single source of truth (no orphan opens from prior runs).
export async function flushCandlesBatch(candles: OtcCandle[]): Promise<void> {
  if (candles.length === 0) return
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
      "openPrice"   = EXCLUDED."openPrice",
      "highPrice"   = EXCLUDED."highPrice",
      "lowPrice"    = EXCLUDED."lowPrice",
      "closePrice"  = EXCLUDED."closePrice",
      "tickCount"   = EXCLUDED."tickCount",
      "finalizedAt" = EXCLUDED."finalizedAt"
  `
}
