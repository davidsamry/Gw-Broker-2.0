import type { OtcCandle, OtcTimeframe } from './types.js'

// One CandleBuilder owns the rolling OHLC state for a single (asset,
// timeframe) tuple. The worker holds 25 of these — 5 assets × 5
// timeframes — feeds them every tick, and persists when one finalises.

interface BuildingCandle {
  openTime:  number       // epoch ms (slot start)
  open:      number
  high:      number
  low:       number
  close:     number
  tickCount: number
}

export class CandleBuilder {
  /** Current candle in progress. Null only before the very first tick. */
  private state: BuildingCandle | null = null

  constructor(
    public readonly assetId:   string,
    public readonly timeframe: OtcTimeframe,
  ) {}

  /**
   * Feed a price tick. Returns:
   *   • current — the candle that just got updated (always set after
   *     first call) — for live "update current bar" events.
   *   • finalized — non-null only on the message where the previous
   *     candle just closed (caller persists + emits a 'candle' event).
   */
  onTick(price: number, atMs: number): {
    current:   OtcCandle
    finalized: OtcCandle | null
  } {
    const tfMs = this.timeframe * 1000
    const slotOpenTime = Math.floor(atMs / tfMs) * tfMs

    if (this.state && this.state.openTime === slotOpenTime) {
      // Same slot — mutate in place.
      this.state.high  = Math.max(this.state.high, price)
      this.state.low   = Math.min(this.state.low,  price)
      this.state.close = price
      this.state.tickCount++
      return { current: this.toCandle(this.state, false), finalized: null }
    }

    // Rolled over — the previous candle (if any) is now complete.
    const finalized = this.state ? this.toCandle(this.state, true) : null
    this.state = {
      openTime:  slotOpenTime,
      open:      price,
      high:      price,
      low:       price,
      close:     price,
      tickCount: 1,
    }
    return { current: this.toCandle(this.state, false), finalized }
  }

  /**
   * Seed from persisted history (bootstrap path). Doesn't emit anything.
   *
   * Defensive: clamp the persisted OHLC to its own consistent envelope.
   * If a row in DB ever ends up structurally broken (open > high, etc.)
   * we don't carry the bug forward into the in-memory state — the next
   * tick rebuilds h/l/c from a sane open.
   */
  seedFromCandle(last: OtcCandle | null): void {
    if (!last) { this.state = null; return }
    const high  = Math.max(last.open, last.high, last.close)
    const low   = Math.min(last.open, last.low,  last.close)
    this.state = {
      openTime:  last.openTime.getTime(),
      open:      last.open,
      high,
      low,
      close:     last.close,
      tickCount: last.tickCount,
    }
  }

  getCurrent(): OtcCandle | null {
    return this.state ? this.toCandle(this.state, false) : null
  }

  // Last line of defense: every candle we hand out has guaranteed
  // structural OHLC consistency (high >= max(open, close), low <= min).
  // The same-slot tick branch already enforces this via Math.max/min,
  // and seedFromCandle clamps on load, so this should always be a
  // no-op — but if any future bug ever skews state, the bad value
  // never reaches the chart or the DB.
  private toCandle(b: BuildingCandle, finalized: boolean): OtcCandle {
    const high = Math.max(b.open, b.high, b.close)
    const low  = Math.min(b.open, b.low,  b.close)
    return {
      assetId:    this.assetId,
      timeframe:  this.timeframe,
      openTime:   new Date(b.openTime),
      open:       b.open,
      high,
      low,
      close:      b.close,
      tickCount:  b.tickCount,
      finalizedAt: finalized ? new Date() : null,
    }
  }
}
