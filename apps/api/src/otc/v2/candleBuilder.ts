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

  /** Seed from persisted history (bootstrap path). Doesn't emit anything. */
  seedFromCandle(last: OtcCandle | null): void {
    if (!last) { this.state = null; return }
    this.state = {
      openTime:  last.openTime.getTime(),
      open:      last.open,
      high:      last.high,
      low:       last.low,
      close:     last.close,
      tickCount: last.tickCount,
    }
  }

  getCurrent(): OtcCandle | null {
    return this.state ? this.toCandle(this.state, false) : null
  }

  private toCandle(b: BuildingCandle, finalized: boolean): OtcCandle {
    return {
      assetId:    this.assetId,
      timeframe:  this.timeframe,
      openTime:   new Date(b.openTime),
      open:       b.open,
      high:       b.high,
      low:        b.low,
      close:      b.close,
      tickCount:  b.tickCount,
      finalizedAt: finalized ? new Date() : null,
    }
  }
}
