// Forex (cTrader) client — mirrors otcMarket.ts almost verbatim.
//
// The only meaningful differences from OTC v2:
//   • URL prefix /forex/v1/* instead of /otc/v2/*
//   • The endpoint for initial candles is /forex/v1/candles?asset=&tf=
//     (query string) instead of /otc/v2/candles/:assetId
//   • Snapshot ticker via /forex/v1/ticker/:asset for the first-paint
//     price label before the SSE delivers its first event
//
// Behavioural contract is identical so TradingChart + TradingPanel can
// branch by asset.source and call into the right lib without further
// special-casing.

import { useEffect, useState } from 'react'
import { api } from './api'
import type { Candle } from './marketTypes'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ── Initial candle history (REST) ────────────────────────────────────────
// Server returns ASCENDING by openTime so the chart's render loop can
// append without re-sorting. Same shape as fetchOtcCandles for symmetry.
export async function fetchForexCandles(
  assetId: string,
  tf: number,
  // Mirrors OTC v2's 1000-candle initial payload (≈80KB) — enough scroll
  // back for analysis without blocking first paint. Server caps at 3000.
  limit = 1000,
): Promise<Candle[]> {
  const { data } = await api.get<{ candles: Candle[] }>('/forex/v1/candles', {
    params: { asset: assetId, tf, limit },
  })
  return data.candles ?? []
}

// ── Snapshot ticker — used by asset selector / chart first paint ─────────
// Returns the latest bid/ask + timestamp. Null when the asset hasn't
// ticked yet (cold boot, just after a deploy).
export interface ForexTickerSnapshot {
  assetId:    string
  bid:        number | null
  ask:        number | null
  lastTickAt: string | null
}
export async function fetchForexTicker(assetId: string): Promise<ForexTickerSnapshot | null> {
  try {
    const { data } = await api.get<ForexTickerSnapshot>(`/forex/v1/ticker/${encodeURIComponent(assetId)}`)
    return data
  } catch {
    return null
  }
}

// ── Live SSE — types ─────────────────────────────────────────────────────
export interface ForexTick {
  assetId: string
  price:   number
  /** epoch ms */
  time:    number
}

export interface ForexCandleEvent {
  assetId:   string
  timeframe: number
  /** epoch ms (slot start) */
  openTime:  number
  open:      number
  high:      number
  low:       number
  close:     number
  /** true on finalization, false on every in-progress update */
  isClosed:  boolean
}

// ── Pool of EventSource connections ──────────────────────────────────────
// One connection per assetId, shared between ticker + candle consumers
// (mirrors OTC v2's pool). Debounced close so a chart remount during
// asset switch doesn't pay the full SSE handshake again.

type TickCallback   = (t: ForexTick)         => void
type CandleCallback = (c: ForexCandleEvent)  => void

interface PoolEntry {
  es:          EventSource
  tickSubs:    Set<TickCallback>
  candleSubs:  Set<CandleCallback>
  latestPrice: number | null
}

const pool             = new Map<string, PoolEntry>()
const pendingCloses    = new Map<string, ReturnType<typeof setTimeout>>()
const CLOSE_DEBOUNCE_MS = 500

function ensureConnection(assetId: string): PoolEntry {
  // Cancel any pending close — we're back, don't kill it.
  const pending = pendingCloses.get(assetId)
  if (pending) {
    clearTimeout(pending)
    pendingCloses.delete(assetId)
  }

  const existing = pool.get(assetId)
  if (existing) return existing

  const url = `${API_URL.replace(/\/$/, '')}/forex/v1/stream?assets=${encodeURIComponent(assetId)}`
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
      const tick: ForexTick = { assetId, price: data.price, time: data.time }
      for (const cb of entry.tickSubs) cb(tick)
    } catch { /* malformed — skip */ }
  })

  es.addEventListener('candle', (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as ForexCandleEvent
      for (const cb of entry.candleSubs) cb(data)
    } catch { /* malformed — skip */ }
  })

  // EventSource auto-reconnects on transient drops — no manual loop.

  return entry
}

function releaseIfEmpty(assetId: string) {
  const entry = pool.get(assetId)
  if (!entry) return
  if (entry.tickSubs.size === 0 && entry.candleSubs.size === 0) {
    const existing = pendingCloses.get(assetId)
    if (existing) clearTimeout(existing)
    pendingCloses.set(assetId, setTimeout(() => {
      pendingCloses.delete(assetId)
      const e = pool.get(assetId)
      if (!e) return
      if (e.tickSubs.size === 0 && e.candleSubs.size === 0) {
        try { e.es.close() } catch { /* already closed */ }
        pool.delete(assetId)
      }
    }, CLOSE_DEBOUNCE_MS))
  }
}

// ── Imperative API ───────────────────────────────────────────────────────
export function subscribeForexTicks(assetId: string, onTick: TickCallback): () => void {
  const entry = ensureConnection(assetId)
  entry.tickSubs.add(onTick)
  // Synchronous catch-up so the consumer doesn't sit on null until the
  // next tick (~1.5s for forex polling cadence — long enough to notice).
  if (entry.latestPrice != null) {
    onTick({ assetId, price: entry.latestPrice, time: Date.now() })
  }
  return () => {
    entry.tickSubs.delete(onTick)
    releaseIfEmpty(assetId)
  }
}

export function subscribeForexCandles(
  assetId:   string,
  timeframe: number,
  onCandle:  CandleCallback,
): () => void {
  const entry = ensureConnection(assetId)
  const wrapped = (c: ForexCandleEvent) => {
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
// Returns the latest tick price, or null while loading / for non-forex
// assets (caller passes null in that case).
export function useForexLivePrice(assetId: string | null): number | null {
  const [price, setPrice] = useState<number | null>(null)

  useEffect(() => {
    if (!assetId) { setPrice(null); return }
    setPrice(null)
    const unsub = subscribeForexTicks(assetId, (t) => setPrice(t.price))
    return unsub
  }, [assetId])

  return price
}
