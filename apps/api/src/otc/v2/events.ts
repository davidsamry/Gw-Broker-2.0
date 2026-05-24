import { EventEmitter } from 'node:events'

// In-process pub/sub for OTC v2. Same shape as the v1 bus but isolated
// so a v1 listener can't accidentally consume v2 events (and vice
// versa). When we scale the API horizontally this gets swapped for
// Redis Pub/Sub; the EVENT SHAPE here is the API contract, so callers
// don't need to change at that point.

export interface OtcV2TickEvent {
  assetId: string
  price:   number     // already rounded to 5 decimals
  /** epoch ms */
  time:    number
}

export interface OtcV2CandleEvent {
  assetId:   string
  timeframe: number
  /** epoch ms (slot start) */
  openTime:  number
  open:      number
  high:      number
  low:       number
  close:     number
  /** true on finalization, false on every interim update */
  isClosed:  boolean
}

class OtcV2Bus extends EventEmitter {
  constructor() {
    super()
    // Plenty of headroom — each SSE connection adds 2 listeners
    // (tick + candle). At 5k concurrent chart sessions we'd need 10k.
    this.setMaxListeners(20_000)
  }
}

export const otcV2Bus = new OtcV2Bus()

export function publishTick(e: OtcV2TickEvent): void {
  otcV2Bus.emit('tick', e)
}

export function publishCandle(e: OtcV2CandleEvent): void {
  otcV2Bus.emit('candle', e)
}
