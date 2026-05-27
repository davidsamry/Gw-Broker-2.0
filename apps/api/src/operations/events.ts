// In-process pub/sub for operation lifecycle events.
//
// Why: when a trade is created or resolved we need every open session of
// the same user to update its UI immediately — multi-device sync, plus
// the case where a bot fires a trade via /bot/v1/trade and the user's
// browser tab should show it pop in.
//
// Scope: single-process bus. If we ever scale the API horizontally we'd
// swap this for Redis Pub/Sub (or the OTC v2 stream registry's pattern),
// but the EVENT SHAPE here is the contract — callers don't need to
// change at that point.

import { EventEmitter } from 'node:events'

export interface OperationEvent {
  /** Lifecycle phase. 'created' fires from service.createOperation,
   *  'resolved' fires from worker.resolveOperation after settlement. */
  kind:   'created' | 'resolved'
  userId: string
  /** Subset of the Operation row the frontend needs. Mirrors the
   *  serialiser shape used by /auth/me + /operations. */
  op: {
    id:          string
    accountId:   string
    assetId:     string
    assetSymbol: string
    direction:   'CALL' | 'PUT'
    amount:      string       // Decimal serialised
    payout:      number
    profit:      string | null
    status:      'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
    entryPrice:  string
    exitPrice?:  string | null
    expiresAt:   string       // ISO
    openedAt:    string       // ISO
    closedAt?:   string | null
  }
}

class OperationsBus extends EventEmitter {
  constructor() {
    super()
    // Each SSE connection adds 1 listener. Plenty of headroom — at
    // 5k concurrent web sessions we'd need 5k. EventEmitter warns at
    // 10 by default; we cap explicitly.
    this.setMaxListeners(20_000)
  }
}

const bus = new OperationsBus()

/** Publish a lifecycle event. Fan-out is delivered to every subscriber;
 *  filtering by userId happens on the listener side. */
export function publishOperationEvent(e: OperationEvent): void {
  bus.emit('op', e)
}

/** Subscribe to events for ONE user. Returns the unsubscribe function. */
export function subscribeToUserOperations(
  userId:   string,
  listener: (e: OperationEvent) => void,
): () => void {
  const wrapper = (e: OperationEvent) => {
    if (e.userId !== userId) return
    listener(e)
  }
  bus.on('op', wrapper)
  return () => { bus.off('op', wrapper) }
}
