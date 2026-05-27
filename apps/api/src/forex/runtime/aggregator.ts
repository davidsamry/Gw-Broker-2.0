// Forex candle aggregator.
//
// Receives normalised ForexTick events from the provider (cTrader F2)
// and folds them into OHLC bars for every configured timeframe (1m, 5m,
// 15m, 1h). In-progress bars live in RAM; finalized bars are persisted
// to `forex_candles` (UPSERT on the unique key assetId+timeframe+open
// Time so a restart-mid-bar can write the same row again without
// duplicating).
//
// Each tick also flushes the latest bid/ask/timestamp to
// `forex_engine_snapshot` (singleton per asset). That lets a future
// restart hydrate the current price for the chart without waiting for
// the first poll cycle, and gives the admin status page a "last tick
// seen" timestamp without keeping a separate counter.
//
// Snapshot writes are best-effort and don't block the tick path.

import { prisma } from '../../prisma.js'
import { FOREX_TIMEFRAMES, type ForexTick, type ForexTimeframe } from '../types.js'

// In-progress bar. Closed bars are written to the DB and dropped from
// memory; only the currently-open bar per (asset, timeframe) lives here.
interface InProgressBar {
  openTime: number   // epoch ms — slot start
  open:     number
  high:     number
  low:      number
  close:    number
  tickCount: number
}

// assetId → timeframe → bar
const inFlight = new Map<string, Map<ForexTimeframe, InProgressBar>>()

/** Compute the slot-start epoch ms for the given tick + timeframe. */
function slotStart(tickMs: number, tfSec: number): number {
  const tfMs = tfSec * 1000
  return Math.floor(tickMs / tfMs) * tfMs
}

/**
 * Public entry point — call from the provider's onTick handler.
 * Synchronous in the hot path; DB writes are fire-and-forget.
 */
export function aggregateTick(tick: ForexTick): void {
  // Snapshot the last bid/ask — fire-and-forget so a slow DB doesn't
  // pile up tick processing. Errors are logged but never thrown.
  void writeSnapshot(tick)

  let perTf = inFlight.get(tick.assetId)
  if (!perTf) {
    perTf = new Map()
    inFlight.set(tick.assetId, perTf)
  }

  for (const tf of FOREX_TIMEFRAMES) {
    const slot = slotStart(tick.timestamp, tf)
    const current = perTf.get(tf)

    if (!current) {
      // First tick we've ever seen for this (asset, tf) — start a bar.
      perTf.set(tf, openBar(slot, tick.mid))
      continue
    }

    if (current.openTime !== slot) {
      // Slot rolled over. Finalize the prior bar, then open a new one
      // anchored at the new slot.
      void persistBar(tick.assetId, tf, current, /*finalized=*/true)
      perTf.set(tf, openBar(slot, tick.mid))
      continue
    }

    // Same slot — update OHLC.
    current.close      = tick.mid
    current.high       = Math.max(current.high, tick.mid)
    current.low        = Math.min(current.low,  tick.mid)
    current.tickCount += 1
  }
}

function openBar(openTime: number, price: number): InProgressBar {
  return {
    openTime,
    open:      price,
    high:      price,
    low:       price,
    close:     price,
    tickCount: 1,
  }
}

/**
 * UPSERT a single bar into forex_candles. Called when a slot rolls over
 * (finalized=true). On conflict — which happens on restart-mid-bar +
 * snapshot recovery later — the existing row is updated rather than
 * duplicated; the unique index on (assetId, timeframe, openTime) is the
 * key.
 */
async function persistBar(
  assetId:   string,
  timeframe: ForexTimeframe,
  bar:       InProgressBar,
  finalized: boolean,
): Promise<void> {
  try {
    const openTime    = new Date(bar.openTime)
    const finalizedAt = finalized ? new Date() : null
    await prisma.$executeRaw`
      INSERT INTO forex_candles
        ("assetId", "timeframe", "openTime", "openPrice", "highPrice", "lowPrice", "closePrice", "tickCount", "finalizedAt")
      VALUES
        (${assetId}, ${timeframe}, ${openTime}, ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, ${bar.tickCount}, ${finalizedAt})
      ON CONFLICT ("assetId", "timeframe", "openTime") DO UPDATE
        SET "openPrice"   = EXCLUDED."openPrice",
            "highPrice"   = EXCLUDED."highPrice",
            "lowPrice"    = EXCLUDED."lowPrice",
            "closePrice"  = EXCLUDED."closePrice",
            "tickCount"   = EXCLUDED."tickCount",
            "finalizedAt" = EXCLUDED."finalizedAt"
    `
  } catch (err) {
    console.error(`[forex/agg] persistBar failed for ${assetId} tf=${timeframe}`, err)
  }
}

/**
 * Mirror the latest tick into forex_engine_snapshot (singleton per asset).
 * Used by /forex/v1/status, future SSE hydration, and to surface "last
 * tick seen" in the admin panel.
 */
async function writeSnapshot(tick: ForexTick): Promise<void> {
  try {
    const ts = new Date(tick.timestamp)
    await prisma.$executeRaw`
      INSERT INTO forex_engine_snapshot
        ("assetId", "lastBid", "lastAsk", "lastTickAt", "updatedAt")
      VALUES
        (${tick.assetId}, ${tick.bid}, ${tick.ask}, ${ts}, NOW())
      ON CONFLICT ("assetId") DO UPDATE
        SET "lastBid"    = EXCLUDED."lastBid",
            "lastAsk"    = EXCLUDED."lastAsk",
            "lastTickAt" = EXCLUDED."lastTickAt",
            "updatedAt"  = NOW()
    `
  } catch (err) {
    console.error(`[forex/agg] snapshot write failed for ${tick.assetId}`, err)
  }
}

/**
 * Periodic flush of in-progress bars — writes them as `finalized=false`
 * rows so a restart can resume mid-bar without losing the OHLC built so
 * far. Driven by setInterval in boot.ts.
 *
 * Idempotent: same UPSERT path as finalizeOnRollover; only the
 * finalizedAt column differs (NULL while still aggregating).
 */
export async function flushInFlightBars(): Promise<void> {
  for (const [assetId, perTf] of inFlight) {
    for (const [tf, bar] of perTf) {
      await persistBar(assetId, tf, bar, /*finalized=*/false)
    }
  }
}

/** Diagnostics — admin status page. */
export function getAggregatorStats(): {
  trackedAssets: number
  trackedBars:   number
  bars:          Array<{ assetId: string; timeframe: number; openTime: number; tickCount: number }>
} {
  const bars: Array<{ assetId: string; timeframe: number; openTime: number; tickCount: number }> = []
  for (const [assetId, perTf] of inFlight) {
    for (const [tf, bar] of perTf) {
      bars.push({ assetId, timeframe: tf, openTime: bar.openTime, tickCount: bar.tickCount })
    }
  }
  return {
    trackedAssets: inFlight.size,
    trackedBars:   bars.length,
    bars,
  }
}

/** Reset internal state — used by tests + clean shutdowns. */
export function resetAggregator(): void {
  inFlight.clear()
}
