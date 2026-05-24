import { useEffect, useState } from 'react'
import { api } from './api'
import type { Candle } from './marketTypes'

// Feature flag was retired after the OTC server-side stream proved itself
// in production. Streaming is now the default and only path for non-Binance
// assets. The constant stays exported as `true` so any third-party code
// importing it keeps compiling, but nothing in this repo checks it anymore.
export const isOtcStreamEnabled = true

// EventSource doesn't go through axios so we need the raw base URL.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ── Initial candle history ───────────────────────────────────────────────
// Server returns epoch SECONDS in UTC; chart renders BRT-shifted times, so
// consumers shift by BRT_OFFSET themselves (we don't do it here to keep
// this lib timezone-agnostic).
export async function fetchOtcCandles(
  assetId: string,
  tf: number,
  limit = 150,
): Promise<Candle[]> {
  const { data } = await api.get<{ candles: Candle[] }>(`/otc/candles/${assetId}`, {
    params: { tf, limit },
  })
  return data.candles ?? []
}

// ── Live tick stream (SSE) — shared connection pool ──────────────────────
export interface OtcTick {
  assetId: string
  price:   number
  /** epoch seconds, UTC */
  time:    number
}

type TickCallback = (tick: OtcTick) => void

interface PoolEntry {
  es:           EventSource
  subscribers:  Set<TickCallback>
  latestPrice:  number | null   // last price seen — lets new subscribers get a value instantly
}

// Module-level pool keyed by assetId. When multiple components subscribe
// to the same asset (TradingChart + TradingCompactCard + TradingPanel all
// on the same page), they share a single EventSource — one TCP connection
// per asset instead of one per component.
const pool = new Map<string, PoolEntry>()

function ensureConnection(assetId: string): PoolEntry {
  const existing = pool.get(assetId)
  if (existing) return existing

  const url = `${API_URL.replace(/\/$/, '')}/otc/stream?assets=${encodeURIComponent(assetId)}`
  const es  = new EventSource(url)
  const entry: PoolEntry = { es, subscribers: new Set(), latestPrice: null }
  pool.set(assetId, entry)

  es.addEventListener('tick', (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as OtcTick
      entry.latestPrice = data.price
      for (const cb of entry.subscribers) cb(data)
    } catch {
      /* malformed payload — skip */
    }
  })

  // EventSource auto-reconnects on transient drops — no manual handling
  // needed unless we ever want to surface connection state to the UI.

  return entry
}

function releaseSubscriber(assetId: string, cb: TickCallback) {
  const entry = pool.get(assetId)
  if (!entry) return
  entry.subscribers.delete(cb)
  if (entry.subscribers.size === 0) {
    try { entry.es.close() } catch { /* already closed */ }
    pool.delete(assetId)
  }
}

// Imperative API — used by TradingChart's draw loop where the cost of a
// re-render per tick would be wasteful (chart mutates DOM via the
// lightweight-charts series directly).
export function subscribeOtcTicks(assetId: string, onTick: TickCallback): () => void {
  const entry = ensureConnection(assetId)
  entry.subscribers.add(onTick)
  // If we already have a recent price, deliver it synchronously so callers
  // don't sit on null until the next tick (~1s wait).
  if (entry.latestPrice != null) {
    onTick({ assetId, price: entry.latestPrice, time: Math.floor(Date.now() / 1000) })
  }
  return () => releaseSubscriber(assetId, onTick)
}

// Hook API — used by the trade panels where the visible price needs to
// trigger a re-render. Returns null when assetId is null OR before the
// first tick lands (the panel can fall back to asset.price meanwhile).
// Pass null for Binance assets — they have their own external feed.
export function useOtcLivePrice(assetId: string | null): number | null {
  const [price, setPrice] = useState<number | null>(null)

  useEffect(() => {
    if (!assetId) {
      setPrice(null)
      return
    }
    setPrice(null)
    const unsub = subscribeOtcTicks(assetId, (t) => setPrice(t.price))
    return unsub
  }, [assetId])

  return price
}
