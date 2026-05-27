// In-process pub/sub for forex events.
//
// Same pattern as apps/api/src/otc/v2/stream/bus.ts — an EventEmitter
// with two named channels (tick + candle). The aggregator publishes on
// every tick + on candle rollover; the SSE route subscribes per client.
// When we eventually scale horizontally we swap the bus for Redis Pub/
// Sub; the EVENT SHAPE is the API contract so callers don't change.

import { EventEmitter } from 'node:events'
import type { ForexTimeframe } from '../types.js'

export interface ForexTickEvent {
  assetId: string
  /** mid-price (close of latest poll). Pre-rounded to asset.digits. */
  price:   number
  /** epoch ms */
  time:    number
}

export interface ForexCandleEvent {
  assetId:   string
  timeframe: ForexTimeframe
  /** epoch ms — slot start */
  openTime:  number
  open:      number
  high:      number
  low:       number
  close:     number
  /** true on finalization, false on every interim update */
  isClosed:  boolean
}

class ForexBus extends EventEmitter {
  constructor() {
    super()
    // Plenty of headroom — each SSE client adds 2 listeners (tick +
    // candle). 20k = 10k concurrent chart sessions.
    this.setMaxListeners(20_000)
  }
}

export const forexBus = new ForexBus()

export function publishTick(e: ForexTickEvent): void {
  forexBus.emit('tick', e)
}

export function publishCandle(e: ForexCandleEvent): void {
  forexBus.emit('candle', e)
}
