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
 *
 * Random-walk character is calibrated to MATCH the live engine so
 * historical bootstrap candles and live candles look continuous on
 * the chart. The live engine ticks at 10Hz with per-tick std =
 * volatilityBase, so per-candle cumulative std = volatilityBase ×
 * √(timeframe × 10). We sample gaussian (not uniform — uniform was
 * the old formula and produced too-narrow bodies, ~4 pips for EUR/USD
 * vs ~30 pips live).
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
  // Per-candle cumulative volatility under the live engine's 10Hz tick rate.
  const candleStd = asset.volatilityBase * Math.sqrt(timeframe * 10)
  // Mean-reversion per candle — softer than live (-0.0002/tick = -0.12/candle)
  // because we're stepping per-candle here. Keeps the 3000-bar walk anchored
  // near seed without snapping every candle.
  const reversionStrength = 0.05

  for (let i = 0; i < count; i++) {
    const openTime = new Date(startSlotMs + i * tfMs)
    const open = price

    // Body: gaussian shock — matches the live engine's per-tick accumulation.
    const bodyShock = gaussian() * candleStd
    const close     = price * (1 + bodyShock)

    // Wicks: half-magnitude shocks on either side, positive-only so they
    // always extend BEYOND the body. Gives the random-walk feel without
    // letting wicks dominate.
    const hiExt = Math.abs(gaussian()) * candleStd * 0.5
    const loExt = Math.abs(gaussian()) * candleStd * 0.5
    const high  = Math.max(open, close) * (1 + hiExt)
    const low   = Math.min(open, close) * (1 - loExt)

    rows.push({
      assetId:    asset.id,
      timeframe,
      openTime,
      openPrice:  round5(open),
      highPrice:  round5(high),
      lowPrice:   round5(low),
      closePrice: round5(close),
      // Match live tick rate (10Hz) for the count.
      tickCount:  Math.max(1, timeframe * 10),
      finalizedAt: openTime,
    })

    // Step + mean-revert pull toward seed.
    price = close + (asset.seedPrice - close) * reversionStrength
  }

  return rows
}

// Box-Muller — same impl as pricingEngine.gaussian but local to keep this
// module self-contained.
function gaussian(): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
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
  // Batch size for INSERTs. A single INSERT of 3000 rows × 9 cols hits
  // 27k Prisma parameters — within PG's 65k limit but flaky through
  // poolers (Supabase Supavisor in particular). 500 keeps each round-
  // trip well under any limit.
  const BATCH = 500

  for (const asset of assets) {
    for (const tf of OTC_TIMEFRAMES) {
      try {
        const existing = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM otc_candles
          WHERE "assetId" = ${asset.id} AND timeframe = ${tf}
        `
        const have = Number(existing[0]?.count ?? 0)
        if (have >= CANDLES_PER_TF) continue

        const need = CANDLES_PER_TF - have
        const rows = generateHistorical(asset, tf, need)

        let inserted = 0
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk  = rows.slice(i, i + BATCH)
          const values = chunk.map(r => Prisma.sql`(
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
          inserted += chunk.length
        }
        console.log(`[otc-v2] bootstrap: ${asset.id} tf=${tf} inserted ${inserted}/${need} candles`)
      } catch (err) {
        // Surface the failure loudly. A silent bootstrap failure left
        // production with empty otc_candles for hours after the previous
        // deploy — the chart still ran (live ticks accumulated via SSE)
        // but the y-axis exploded as wild reversion candles formed.
        console.error(`[otc-v2] bootstrap FAILED for ${asset.id} tf=${tf}:`, err)
      }
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
