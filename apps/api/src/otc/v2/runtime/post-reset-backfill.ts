// Post-reset history backfill.
//
// After fullResetEngine the DB is wiped + the in-memory engine is back
// to seedPrice. The chart would otherwise show an empty plot until
// enough live candles accumulate. To give the user immediate visual
// context we inject `BACKFILL_AFTER_RESET` (default 500) flat candles
// per timeframe immediately BEFORE the slot the engine is about to
// open — anchored to the actual open price of the first post-reset
// tick (not seedPrice — they're nearly identical but using the real
// observed tick price avoids any visible discontinuity at the join).
//
// Lifecycle:
//   1. fullResetEngine sets s.pendingBackfillCount = N on every asset
//   2. Next tick on the asset loop: if the flag is set, call
//      injectBackwardsHistory(...) with the tick's price, then clear it
//   3. Function inserts N candles per tf into otc_candles via UPSERT,
//      prepends them to candleCache so REST + SSE consumers see them
//
// Visual: all 500 candles are OHLC = openPrice (flat dojis). The first
// live candle starts at openPrice and is allowed to drift naturally.

import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma.js'
import type { OtcCandle } from '../types.js'
import { OTC_TIMEFRAMES, CANDLES_PER_TF } from '../types.js'
import { candleCache } from './state-map.js'

/**
 * Generate + persist N flat historical candles per timeframe for one
 * asset. All candles share the same OHLC = `openPrice`. Open times
 * walk backwards from the slot immediately BEFORE `nowMs` (one slot
 * per step, per timeframe's seconds).
 *
 * Idempotent — uses the same UPSERT path as flushCandlesBatch, so a
 * second call with the same args overwrites the existing rows in place.
 */
export async function injectBackwardsHistory(
  assetId:   string,
  openPrice: number,
  count:     number,
  nowMs:     number,
): Promise<{ candlesInserted: number }> {
  if (count <= 0) return { candlesInserted: 0 }

  let inserted = 0

  // Per-timeframe insert + cache prepend. We could batch all 5 tfs into
  // one big INSERT, but keeping them split lets us recover gracefully
  // if one tf hits a constraint while another succeeds.
  for (const tf of OTC_TIMEFRAMES) {
    const tfMs            = tf * 1000
    // Slot the engine is about to open (or already opened) covers nowMs.
    // Backfill fills the `count` slots IMMEDIATELY BEFORE this one.
    const currentSlotOpen = Math.floor(nowMs / tfMs) * tfMs

    const candles: OtcCandle[] = []
    for (let i = count; i >= 1; i--) {
      const openTimeMs = currentSlotOpen - i * tfMs
      candles.push({
        assetId,
        timeframe:   tf,
        openTime:    new Date(openTimeMs),
        open:        openPrice,
        high:        openPrice,
        low:         openPrice,
        close:       openPrice,
        tickCount:   0,
        // Mark as finalized — these are synthetic historicals, never
        // expected to receive more ticks. finalizedAt = slot close.
        finalizedAt: new Date(openTimeMs + tfMs),
      })
    }

    // Bulk UPSERT — same shape as flushCandlesBatch. ON CONFLICT covers
    // the (assetId, timeframe, openTime) unique constraint.
    const values = candles.map((c) => Prisma.sql`(
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
    inserted += candles.length

    // Merge into the in-memory cache so REST + SSE consumers see the
    // backfill on the very next read. The engine may have ticked again
    // while we awaited the DB write, adding live candles after our
    // historicals — we filter to only prepend entries strictly OLDER
    // than what's already in the cache to avoid duplicates.
    const cacheKey  = `${assetId}:${tf}`
    const liveBuf   = candleCache.get(cacheKey) ?? []
    const cutoffMs  = liveBuf[0]?.openTime.getTime() ?? Infinity
    const merged    = [
      ...candles.filter((c) => c.openTime.getTime() < cutoffMs),
      ...liveBuf,
    ]
    // Cap to the ring buffer size (oldest dropped).
    if (merged.length > CANDLES_PER_TF) {
      merged.splice(0, merged.length - CANDLES_PER_TF)
    }
    candleCache.set(cacheKey, merged)
  }

  return { candlesInserted: inserted }
}
