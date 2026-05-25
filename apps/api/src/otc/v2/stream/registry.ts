// Fase 6 — SSE client registry. Single source of truth for every live
// /otc/v2/stream connection. Lets the admin panel report on stream
// health and gives the routes layer a clean place to keep per-client
// throttle state without closure spaghetti.
//
// When we eventually move to a WebSocket gateway (Fase 10 spec), this
// registry shape stays — the only change is the underlying transport.

import { randomUUID } from 'node:crypto'

export interface SseClient {
  id:               string          // UUID assigned at connect time
  connectedAt:      number          // epoch ms
  // Filters from query string. null = all.
  assets:           string[] | null
  timeframe:        number | null
  // Stats — incremented on every successful write.
  ticksReceived:    number
  candlesReceived:  number
  candlesSkipped:   number    // backpressure drops
  // Per-asset throttle state (last-emit ms). Lives here (not in
  // closures) so the route handler stays simple and admin can inspect.
  lastTickEmitMs:   Map<string, number>
  lastCandleEmitMs: Map<string, number>
  // Set by cleanup. Guards all the listener callbacks so anything
  // racing after disconnect just returns.
  closed:           boolean
}

// All currently-connected SSE clients. Cleared when each disconnects.
const clients = new Map<string, SseClient>()

export function registerClient(opts: {
  assets:    string[] | null
  timeframe: number | null
}): SseClient {
  const c: SseClient = {
    id:               randomUUID(),
    connectedAt:      Date.now(),
    assets:           opts.assets,
    timeframe:        opts.timeframe,
    ticksReceived:    0,
    candlesReceived:  0,
    candlesSkipped:   0,
    lastTickEmitMs:   new Map(),
    lastCandleEmitMs: new Map(),
    closed:           false,
  }
  clients.set(c.id, c)
  return c
}

export function unregisterClient(id: string): void {
  const c = clients.get(id)
  if (c) c.closed = true
  clients.delete(id)
}

export function listClients(): SseClient[] {
  return Array.from(clients.values())
}

export function clientCount(): number {
  return clients.size
}
