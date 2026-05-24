import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import type { OtcAssetConfig, OtcCandle } from './types.js'
import { CANDLES_PER_TF, OTC_TIMEFRAMES } from './types.js'

// First-boot helper: for each (asset, timeframe) without enough history
// in the DB, synthesise candles BACKWARDS from now-3000×tf seconds. The
// frontend gets a useful chart on day-1 instead of waiting hours for
// real ticks to accumulate.
//
// The historical generator uses a SIMPLIFIED walk (no FSM, no
// liquidity) — those layers add value over time, but for static
// historical fill they'd be overkill. Subsequent live operation uses
// the full engine.

const ROUND_DECIMALS = 5

function round5(v: number): number {
  return Math.round(v * 10 ** ROUND_DECIMALS) / 10 ** ROUND_DECIMALS
}

interface HistoricalCandleRow {
  assetId:    string
  timeframe:  number
  openTime:   Date
  openPrice:  number
  highPrice:  number
  lowPrice:   number
  closePrice: number
  tickCount:  number
  finalizedAt: Date
}

/**
 * Generate up to N candles backwards. Returns array sorted ascending
 * by openTime (oldest first).
 */
function generateHistorical(
  asset:     OtcAssetConfig,
  timeframe: number,
  count:     number,
): HistoricalCandleRow[] {
  const tfMs       = timeframe * 1000
  const nowSlotMs  = Math.floor(Date.now() / tfMs) * tfMs
  const startSlotMs = nowSlotMs - count * tfMs

  const rows: HistoricalCandleRow[] = []
  let price = asset.seedPrice
  // Stronger reversion for the historical fill so the walk doesn't
  // drift catastrophically over thousands of candles.
  const reversionStrength = 0.01

  for (let i = 0; i < count; i++) {
    const openTime = new Date(startSlotMs + i * tfMs)
    const open = price

    // Random walk over the candle, scaled by tf seconds (longer
    // timeframes get bigger candle ranges, like real markets).
    const intraVol  = asset.volatilityBase * Math.sqrt(timeframe)
    const drift     = (Math.random() - 0.5) * 0.0003
    const close     = price * (1 + drift + (Math.random() - 0.5) * intraVol)
    const hiExt     = Math.abs(Math.random()) * intraVol * 0.5
    const loExt     = Math.abs(Math.random()) * intraVol * 0.5
    const high      = Math.max(open, close) * (1 + hiExt)
    const low       = Math.min(open, close) * (1 - loExt)

    rows.push({
      assetId:    asset.id,
      timeframe,
      openTime,
      openPrice:  round5(open),
      highPrice:  round5(high),
      lowPrice:   round5(low),
      closePrice: round5(close),
      // ~2 ticks/sec gives a believable count for any timeframe
      tickCount:  Math.max(1, timeframe * 2),
      finalizedAt: openTime,
    })

    // Step + mean-revert pull toward seed
    price = close + (asset.seedPrice - close) * reversionStrength
  }

  return rows
}

/**
 * Ensure each (asset, tf) has at least CANDLES_PER_TF rows in DB. If
 * fewer, synthesise the missing prefix backwards and bulk-insert.
 *
 * Idempotent — re-running on an already-populated DB does nothing
 * because the unique (assetId, timeframe, openTime) constraint filters
 * dupes (we use ON CONFLICT DO NOTHING).
 */
export async function bootstrapHistoricalCandles(assets: OtcAssetConfig[]): Promise<void> {
  for (const asset of assets) {
    for (const tf of OTC_TIMEFRAMES) {
      const existing = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM otc_candles
        WHERE "assetId" = ${asset.id} AND timeframe = ${tf}
      `
      const have = Number(existing[0]?.count ?? 0)
      if (have >= CANDLES_PER_TF) continue

      const need = CANDLES_PER_TF - have
      const rows = generateHistorical(asset, tf, need)

      // Bulk insert in one round-trip per (asset, tf). With 5 assets × 5
      // tfs × ~3000 candles, the total boot is ~25 inserts of 3000 rows
      // each — ~5-15s total on a cold deploy, then never again.
      const values = rows.map(r => Prisma.sql`(
        ${r.assetId}, ${r.timeframe}, ${r.openTime},
        ${r.openPrice}, ${r.highPrice}, ${r.lowPrice}, ${r.closePrice},
        ${r.tickCount}, ${r.finalizedAt}
      )`)
      await prisma.$executeRaw`
        INSERT INTO otc_candles
          ("assetId", timeframe, "openTime", "openPrice", "highPrice", "lowPrice", "closePrice", "tickCount", "finalizedAt")
        VALUES ${Prisma.join(values, ', ')}
        ON CONFLICT ("assetId", timeframe, "openTime") DO NOTHING
      `
      console.log(`[otc-v2] bootstrap: ${asset.id} tf=${tf} inserted ${rows.length} candles`)
    }
  }
}

/** Load the most recent candle per (asset, tf) — used by worker to seed builders. */
export async function loadLatestCandlePerTimeframe(
  assetIds: string[],
): Promise<Map<string, OtcCandle | null>> {
  // Map key: `${assetId}:${timeframe}`
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
