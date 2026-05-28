// Post-reset history backfill.
//
// After fullResetEngine the DB is wiped + the in-memory engine is back
// to seedPrice. The chart would otherwise show an empty plot until
// enough live candles accumulate. To give the user immediate visual
// context we inject `BACKFILL_AFTER_RESET` (default 500) synthetic
// candles per timeframe immediately BEFORE the slot the engine is about
// to open — anchored to the actual open price of the first post-reset
// tick.
//
// Visual goal: candles look like real market history — random-walk
// chain with proper open/close continuity, varied body sizes, wicks on
// both sides, mix of bull/bear bars. Anchored so the most-recent
// historical's close = the live engine's open (no chart discontinuity).
//
// Lifecycle:
//   1. fullResetEngine sets s.pendingBackfillCount = N on every asset
//   2. Next tick on the asset loop: if the flag is set, call
//      injectBackwardsHistory(...) with the tick's price + asset volatility
//   3. Function generates a backwards random walk, persists to
//      otc_candles via UPSERT, prepends them to candleCache

import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma.js'
import type { OtcCandle } from '../types.js'
import { OTC_TIMEFRAMES, CANDLES_PER_TF, ENGINE_BASE_HZ } from '../types.js'
import { candleCache } from './state-map.js'

// Per-candle body std as a fraction of price. Scaled by sqrt(tickCount)
// per the engine's natural 10Hz tick aggregation — longer slots accumulate
// more ticks ⇒ wider price distribution. The 0.5 multiplier dampens the
// raw vol so M5 candles don't span huge ranges (purely a visual choice).
function bodyStdFractionFor(volatilityBase: number, tfSec: number): number {
  return volatilityBase * Math.sqrt(tfSec * ENGINE_BASE_HZ) * 0.5
}

// Standard normal via Box-Muller. Used for body deltas — gaussian gives
// the bell-shaped distribution real markets show (most candles small,
// occasional big moves).
function gaussian(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Safety clip — never let the random walk drift more than this fraction
// from the anchor. Prevents the auto-scale Y axis from zooming out so
// much that the live candle becomes invisible.
const MAX_DRIFT_FRACTION = 0.02   // ±2% from anchor

interface OHLC { open: number; high: number; low: number; close: number }

/**
 * Generate `count` chained random-walk candles ending at `anchorPrice`.
 * Walks BACKWARDS in price space (chain.close = anchor on the most
 * recent, then each older candle's close = the newer one's open).
 *
 * Returns candles in ASCENDING time order (oldest first, last entry
 * closes at anchorPrice).
 */
function randomWalkBackwards(
  anchorPrice:     number,
  count:           number,
  bodyStdFraction: number,
): OHLC[] {
  // Build the chain backwards then reverse for ascending output.
  const reversed: OHLC[] = []
  let chainPrice    = anchorPrice
  const minPrice    = anchorPrice * (1 - MAX_DRIFT_FRACTION)
  const maxPrice    = anchorPrice * (1 + MAX_DRIFT_FRACTION)

  for (let i = 0; i < count; i++) {
    const close      = chainPrice
    let   bodyDelta  = close * bodyStdFraction * gaussian()

    // Clip if the resulting open would drift out of the safety band.
    // Reflect the delta to pull back toward anchor — keeps the walk
    // inside [-2%, +2%] without flattening the candle entirely.
    let   open       = close - bodyDelta
    if      (open < minPrice) { open = minPrice + (minPrice - open); bodyDelta = close - open }
    else if (open > maxPrice) { open = maxPrice - (open - maxPrice); bodyDelta = close - open }

    const bodyHigh   = Math.max(open, close)
    const bodyLow    = Math.min(open, close)
    // Wick magnitude: 30%-150% of body, independent on each side.
    // Body of zero → use a tiny floor so dojis still get visible wicks.
    const absBody    = Math.max(Math.abs(bodyDelta), close * bodyStdFraction * 0.1)
    const wickUp     = absBody * (0.3 + 1.2 * Math.random())
    const wickDown   = absBody * (0.3 + 1.2 * Math.random())
    const high       = bodyHigh + wickUp
    const low        = Math.max(0.00001, bodyLow - wickDown)

    reversed.push({ open, high, low, close })
    chainPrice = open
  }

  // [most-recent, ..., oldest] → reverse to [oldest, ..., most-recent].
  return reversed.reverse()
}

/**
 * Generate + persist N synthetic historical candles per timeframe for one
 * asset, anchored at `openPrice`. Open times walk backwards from the slot
 * immediately BEFORE `nowMs` (one slot per step, per timeframe's seconds).
 *
 * Idempotent — uses the same UPSERT path as flushCandlesBatch, so a
 * second call with the same args overwrites the existing rows in place.
 */
export async function injectBackwardsHistory(
  assetId:        string,
  openPrice:      number,
  count:          number,
  nowMs:          number,
  volatilityBase: number,
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

    // Generate a chained random walk of `count` OHLCs ending at openPrice.
    // Output is ascending time order: walk[0] is the OLDEST candle,
    // walk[count-1] is the MOST RECENT (whose close == openPrice).
    const sigmaFraction = bodyStdFractionFor(volatilityBase, tf)
    const walk          = randomWalkBackwards(openPrice, count, sigmaFraction)

    const candles: OtcCandle[] = []
    for (let i = 0; i < count; i++) {
      // i=0 → oldest slot (currentSlotOpen - count*tfMs)
      // i=count-1 → most-recent historical (currentSlotOpen - 1*tfMs)
      const openTimeMs = currentSlotOpen - (count - i) * tfMs
      const ohlc       = walk[i]
      candles.push({
        assetId,
        timeframe:   tf,
        openTime:    new Date(openTimeMs),
        open:        ohlc.open,
        high:        ohlc.high,
        low:         ohlc.low,
        close:       ohlc.close,
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
