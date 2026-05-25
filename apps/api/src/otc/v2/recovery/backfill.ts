// Fase 4 — boot-time backfill. Generates calm placeholder candles for
// slots that elapsed between the last persisted candle and `nowSlot`
// (i.e., engine downtime). Per-tf, skips tfs with no anchor row.

import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma.js'
import type { OtcAssetConfig } from '../types.js'
import { OTC_TIMEFRAMES } from '../types.js'
import { round5 } from '../runtime/state-map.js'

// ~10 min for tf=1s, ~10h for tf=60s. Caps an extreme outage so the
// boot can't choke on backfilling days of missing slots.
export const MAX_BACKFILL_SLOTS = 600

// Returns total slots filled across all tfs (used by boot log).
// Operates per-tf using each tf's own latest candle as anchor; tfs
// without any anchor (no rows at all) are skipped silently.
export async function backfillMissingCandles(asset: OtcAssetConfig): Promise<number> {
  let totalFilled = 0
  for (const tf of OTC_TIMEFRAMES) {
    try {
      const tfMs = tf * 1000
      const nowSlot = Math.floor(Date.now() / tfMs) * tfMs

      const rows = await prisma.$queryRaw<Array<{ openTime: Date; closePrice: string }>>`
        SELECT "openTime", "closePrice"::text
        FROM otc_candles
        WHERE "assetId" = ${asset.id} AND timeframe = ${tf}
        ORDER BY "openTime" DESC
        LIMIT 1
      `
      if (rows.length === 0) continue   // no anchor for this tf — skip
      const lastOpen = rows[0].openTime.getTime()
      const lastClose = Number(rows[0].closePrice)

      const gapMs = nowSlot - lastOpen - tfMs
      if (gapMs <= 0) continue
      const missingSlots = Math.min(MAX_BACKFILL_SLOTS, Math.floor(gapMs / tfMs))
      if (missingSlots <= 0) continue

      // Walk softly from lastClose — small per-candle variance so the
      // downtime stretch looks like a calm holding pattern, not a rally.
      const maxStep = asset.volatilityBase * 0.5
      let price = lastClose
      const rowsToInsert: Array<{
        openTime: Date; openPrice: number; highPrice: number;
        lowPrice: number; closePrice: number;
      }> = []
      for (let i = 1; i <= missingSlots; i++) {
        const openTime = new Date(lastOpen + i * tfMs)
        const open = price
        const change = (Math.random() - 0.5) * 2 * maxStep
        const close = price * (1 + change)
        const high  = Math.max(open, close) * (1 + Math.abs(Math.random()) * maxStep * 0.5)
        const low   = Math.min(open, close) * (1 - Math.abs(Math.random()) * maxStep * 0.5)
        rowsToInsert.push({ openTime, openPrice: open, highPrice: high, lowPrice: low, closePrice: close })
        price = close
      }

      const BATCH = 500
      for (let i = 0; i < rowsToInsert.length; i += BATCH) {
        const chunk  = rowsToInsert.slice(i, i + BATCH)
        const values = chunk.map(r => Prisma.sql`(
          ${asset.id}, ${tf}, ${r.openTime},
          ${round5(r.openPrice)}, ${round5(r.highPrice)},
          ${round5(r.lowPrice)},  ${round5(r.closePrice)},
          ${Math.max(1, tf * 10)}, ${r.openTime}
        )`)
        await prisma.$executeRaw`
          INSERT INTO otc_candles
            ("assetId", timeframe, "openTime", "openPrice", "highPrice",
             "lowPrice", "closePrice", "tickCount", "finalizedAt")
          VALUES ${Prisma.join(values, ', ')}
          ON CONFLICT ("assetId", timeframe, "openTime") DO NOTHING
        `
      }
      if (rowsToInsert.length > 0) {
        totalFilled += rowsToInsert.length
        console.log(`[otc-v2] backfilled ${asset.id} tf=${tf}: ${rowsToInsert.length} slots`)
      }
    } catch (err) {
      console.error(`[otc-v2] backfillMissingCandles failed for ${asset.id} tf=${tf}`, err)
    }
  }
  return totalFilled
}
