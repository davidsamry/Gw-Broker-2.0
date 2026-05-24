import { EventEmitter } from 'node:events'

// In-process pub/sub between the OTC worker (publisher) and the SSE route
// (subscriber). Each tick fans out to every connected client without a DB
// round-trip on the read side. Stays single-process for now — when we
// scale the API horizontally this gets swapped for Redis Pub/Sub and the
// API contract on the SSE side doesn't change.

export interface OtcTickEvent {
  assetId: string
  price:   number
  /** epoch seconds (matches the chart's time axis) */
  time:    number
}

class OtcBus extends EventEmitter {
  constructor() {
    super()
    // Each SSE connection adds one listener. 10 is way too low for a
    // multi-client deployment — bump generously, we never expect more
    // than a few thousand concurrent chart sessions per node.
    this.setMaxListeners(10_000)
  }
}

export const otcBus = new OtcBus()

export function publishTick(e: OtcTickEvent): void {
  otcBus.emit('tick', e)
}
