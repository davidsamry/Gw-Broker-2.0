import { useEffect, useState } from 'react'
import { api } from './api'
import type { Candle } from './marketTypes'

// OTC v2 client. Consumes the new /otc/v2/* endpoints (REST + SSE) that
// expose the server-side pricing engine. Replaces the old /otc/* path
// which is now dormant (no assets to drive after the catalog trim).
//
// Two consumption modes share a single EventSource per asset:
//   • subscribeOtcTicks — used by the trade panels to display the live
//     price label; receives only `tick` events.
//   • subscribeOtcCandles — used by the chart; receives `candleUpdate`
//     + `candle` events, filters by timeframe in JS so one pooled
//     connection per asset covers any number of timeframe consumers.

// Feature flag (kept for back-compat with anyone importing it; v2 is
// always on now that the engine ships ready to serve).
export const isOtcStreamEnabled = true

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ── Initial candle history (REST) ────────────────────────────────────────
// Server returns epoch SECONDS in UTC. Chart axis runs on BRT — caller
// applies the offset (we don't here to keep this lib timezone-agnostic).
export async function fetchOtcCandles(
  assetId: string,
  tf: number,
  limit = 3000,
): Promise<Candle[]> {
  const { data } = await api.get<{ candles: Candle[] }>(`/otc/v2/candles/${assetId}`, {
    params: { tf, limit },
  })
  return data.candles ?? []
}

// ── Live SSE — types ─────────────────────────────────────────────────────
export interface OtcTick {
  assetId: string
  price:   number
  /** epoch ms (server emits ms for tick + candle events) */
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
  /** true on finalization (rollover), false on every in-progress update */
  isClosed:  boolean
}

// ── Pool of EventSource connections ──────────────────────────────────────
// Keyed by assetId only (no tf in the URL) so a chart consuming candles
// for tf=60 and a trade panel consuming ticks can share one TCP
// connection. Closed when both subscriber sets empty.
//
// Bandwidth math: 5 OTC assets × all event types ≈ ~5 KB/sec per asset.
// Trivial; sharing is mostly about reducing socket count, not bytes.

type TickCallback   = (t: OtcTick) => void
type CandleCallback = (c: OtcV2CandleEvent) => void

interface PoolEntry {
  es:           EventSource
  tickSubs:     Set<TickCallback>
  candleSubs:   Set<CandleCallback>
  latestPrice:  number | null
}

const pool = new Map<string, PoolEntry>()

function ensureConnection(assetId: string): PoolEntry {
  const existing = pool.get(assetId)
  if (existing) return existing

  // No ?tf — server emits ticks (untyped) + candle events for all tfs.
  // Candle consumers filter by timeframe in their callback.
  const url = `${API_URL.replace(/\/$/, '')}/otc/v2/stream?assets=${encodeURIComponent(assetId)}`
  const es  = new EventSource(url)
  const entry: PoolEntry = {
    es,
    tickSubs:    new Set(),
    candleSubs:  new Set(),
    latestPrice: null,
  }
  pool.set(assetId, entry)

  es.addEventListener('tick', (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as { price: number; time: number }
      entry.latestPrice = data.price
      const tick: OtcTick = { assetId, price: data.price, time: data.time }
      for (const cb of entry.tickSubs) cb(tick)
    } catch { /* malformed — skip */ }
  })

  const candleHandler = (evt: Event) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as OtcV2CandleEvent
      for (const cb of entry.candleSubs) cb(data)
    } catch { /* malformed — skip */ }
  }
  es.addEventListener('candleUpdate', candleHandler)
  es.addEventListener('candle',       candleHandler)

  // EventSource auto-reconnects on transient drops — no manual loop.

  return entry
}

function releaseIfEmpty(assetId: string) {
  const entry = pool.get(assetId)
  if (!entry) return
  if (entry.tickSubs.size === 0 && entry.candleSubs.size === 0) {
    try { entry.es.close() } catch { /* already closed */ }
    pool.delete(assetId)
  }
}

// ── Imperative API: tick subscribe ──────────────────────────────────────
// For the chart's draw loop (it doesn't need React re-renders per tick).
export function subscribeOtcTicks(assetId: string, onTick: TickCallback): () => void {
  const entry = ensureConnection(assetId)
  entry.tickSubs.add(onTick)
  // Synchronous catch-up — if a price is already cached, deliver it now
  // so the consumer doesn't sit on null until the next tick (~200ms).
  if (entry.latestPrice != null) {
    onTick({ assetId, price: entry.latestPrice, time: Date.now() })
  }
  return () => {
    entry.tickSubs.delete(onTick)
    releaseIfEmpty(assetId)
  }
}

// ── Imperative API: candle subscribe ─────────────────────────────────────
// For the chart. Pass the timeframe you care about — events for other
// tfs come down the same connection but are filtered out here.
export function subscribeOtcCandles(
  assetId:   string,
  timeframe: number,
  onCandle:  CandleCallback,
): () => void {
  const entry = ensureConnection(assetId)
  const wrapped = (c: OtcV2CandleEvent) => {
    if (c.timeframe !== timeframe) return
    onCandle(c)
  }
  entry.candleSubs.add(wrapped)
  return () => {
    entry.candleSubs.delete(wrapped)
    releaseIfEmpty(assetId)
  }
}

// ── React hook: live price (used by trade panels) ────────────────────────
// Returns the latest tick price, or null while loading / for Binance
// assets (caller passes null in that case). Re-renders on each tick.
export function useOtcLivePrice(assetId: string | null): number | null {
  const [price, setPrice] = useState<number | null>(null)

  useEffect(() => {
    if (!assetId) { setPrice(null); return }
    setPrice(null)
    const unsub = subscribeOtcTicks(assetId, (t) => setPrice(t.price))
    return unsub
  }, [assetId])

  return price
}
