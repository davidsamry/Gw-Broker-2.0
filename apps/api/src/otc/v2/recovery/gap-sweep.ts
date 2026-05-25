// Fase 4 — periodic gap sweep (every 30s). Detects BOTH interior gaps
// (missing slot between two existing candles) AND trailing gaps
// (between latest persisted and now). Safety net for the boot-time
// backfill — heals anything the boot missed (e.g., the engine booted
// before the backfill code was in production).

import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma.js'
import type { OtcAssetConfig, OtcCandle } from '../types.js'
import { CANDLES_PER_TF, OTC_TIMEFRAMES } from '../types.js'
import { assetStates, candleCache, round5 } from '../runtime/state-map.js'
import { recordGapFill } from '../runtime/diagnostics.js'
import { MAX_BACKFILL_SLOTS } from './backfill.js'

const GAP_DETECT_WINDOW = 200    // last 200 candles is plenty for live UX

// Public entry — walk every loaded asset.
export async function sweepAllGaps(): Promise<void> {
  for (const s of assetStates.values()) {
    try {
      for (const tf of OTC_TIMEFRAMES) {
        await detectAndFillGaps(s.config, tf)
      }
    } catch (err) {
      console.error(`[otc-v2] gap sweep failed for ${s.config.id}`, err)
    }
  }
}

// Looks at the last N candles for a (asset, tf), walks them looking
// for consecutive-pair openTime diffs > tfMs (interior gap) or a tail
// where the latest is more than tfMs behind nowSlot (trailing gap).
// Generates calm placeholder candles for any missing slots, inserts
// them, then refreshes the cache so the API serves them immediately.
async function detectAndFillGaps(asset: OtcAssetConfig, tf: number): Promise<void> {
  try {
    const tfMs = tf * 1000
    const rows = await prisma.$queryRaw<Array<{ openTime: Date; closePrice: string }>>`
      SELECT "openTime", "closePrice"::text
      FROM otc_candles
      WHERE "assetId" = ${asset.id} AND timeframe = ${tf}
      ORDER BY "openTime" DESC
      LIMIT ${GAP_DETECT_WINDOW}
    `
    if (rows.length === 0) return
    // Sort ascending so we can walk consecutive pairs.
    const sorted = rows.slice().reverse()

    const placeholders: Array<{
      openTime: Date; openPrice: number; highPrice: number;
      lowPrice: number; closePrice: number;
    }> = []
    const maxStep = asset.volatilityBase * 0.5

    // INTERIOR gaps: for each consecutive pair, fill anything missing
    // between them. Walks softly from the earlier candle's close.
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]
      const next = sorted[i + 1]
      const currOpen = curr.openTime.getTime()
      const nextOpen = next.openTime.getTime()
      const expectedNextOpen = currOpen + tfMs
      if (nextOpen <= expectedNextOpen) continue   // no gap

      const missingCount = (nextOpen - expectedNextOpen) / tfMs
      const fillCount = Math.min(MAX_BACKFILL_SLOTS, missingCount)
      let price = Number(curr.closePrice)
      for (let j = 0; j < fillCount; j++) {
        const openTime = new Date(expectedNextOpen + j * tfMs)
        const open  = price
        const change = (Math.random() - 0.5) * 2 * maxStep
        const close = price * (1 + change)
        const high  = Math.max(open, close) * (1 + Math.abs(Math.random()) * maxStep * 0.5)
        const low   = Math.min(open, close) * (1 - Math.abs(Math.random()) * maxStep * 0.5)
        placeholders.push({ openTime, openPrice: open, highPrice: high, lowPrice: low, closePrice: close })
        price = close
      }
    }

    // TRAILING gap: from the very last persisted candle to nowSlot.
    const last = sorted[sorted.length - 1]
    const lastOpen = last.openTime.getTime()
    const nowSlot = Math.floor(Date.now() / tfMs) * tfMs
    const trailingGapMs = nowSlot - lastOpen - tfMs
    if (trailingGapMs > 0) {
      const missingCount = Math.min(MAX_BACKFILL_SLOTS, Math.floor(trailingGapMs / tfMs))
      let price = Number(last.closePrice)
      for (let j = 1; j <= missingCount; j++) {
        const openTime = new Date(lastOpen + j * tfMs)
        const open  = price
        const change = (Math.random() - 0.5) * 2 * maxStep
        const close = price * (1 + change)
        const high  = Math.max(open, close) * (1 + Math.abs(Math.random()) * maxStep * 0.5)
        const low   = Math.min(open, close) * (1 - Math.abs(Math.random()) * maxStep * 0.5)
        placeholders.push({ openTime, openPrice: open, highPrice: high, lowPrice: low, closePrice: close })
        price = close
      }
    }

    if (placeholders.length === 0) return

    const BATCH = 500
    for (let i = 0; i < placeholders.length; i += BATCH) {
      const chunk  = placeholders.slice(i, i + BATCH)
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

    // Inject the new placeholders into the in-memory cache at the right
    // positions so the API serves them immediately (without waiting for
    // a worker restart + re-prime).
    const cacheKey = `${asset.id}:${tf}`
    const buf = candleCache.get(cacheKey) ?? []
    for (const p of placeholders) {
      const cand: OtcCandle = {
        assetId:    asset.id,
        timeframe:  tf,
        openTime:   p.openTime,
        open:       round5(p.openPrice),
        high:       round5(p.highPrice),
        low:        round5(p.lowPrice),
        close:      round5(p.closePrice),
        tickCount:  Math.max(1, tf * 10),
        finalizedAt: p.openTime,
      }
      const idx = buf.findIndex(c => c.openTime.getTime() > cand.openTime.getTime())
      if (idx === -1) buf.push(cand)
      else            buf.splice(idx, 0, cand)
    }
    while (buf.length > CANDLES_PER_TF) buf.shift()
    candleCache.set(cacheKey, buf)

    console.log(`[otc-v2] gap sweep: ${asset.id} tf=${tf} filled ${placeholders.length} slots`)
    // Fase 9: surface the fill in the admin diagnostics buffer so the
    // panel can show a "gap alerts (24h)" badge.
    recordGapFill(asset.id, tf, placeholders.length)
  } catch (err) {
    console.error(`[otc-v2] detectAndFillGaps failed for ${asset.id} tf=${tf}`, err)
  }
}
