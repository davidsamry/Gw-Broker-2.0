import { api } from './api'
import type { Candle } from './marketTypes'

// Feature flag. Off by default — set NEXT_PUBLIC_OTC_LIVE_STREAM=1 in the
// frontend env to flip the chart and (later) trade panel onto the
// authoritative server-side OTC stream. When false, everything falls back
// to the legacy per-browser random walk in TradingChart.
const FLAG = process.env.NEXT_PUBLIC_OTC_LIVE_STREAM
export const isOtcStreamEnabled =
  typeof FLAG === 'string' && (FLAG === '1' || FLAG.toLowerCase() === 'true')

// Convenience for SSE — EventSource doesn't go through axios so we need
// the raw base URL.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ── Initial candle history ───────────────────────────────────────────────
// Backed by GET /otc/candles. Server returns epoch SECONDS in UTC; chart
// renders BRT-shifted times, so consumers shift by BRT_OFFSET themselves
// (we don't do it here to keep this lib timezone-agnostic).
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

// ── Live tick stream (SSE) ───────────────────────────────────────────────
export interface OtcTick {
  assetId: string
  price:   number
  /** epoch seconds, UTC */
  time:    number
}

// Subscribes to /otc/stream, filtered server-side to a single asset to
// minimise bandwidth. EventSource auto-reconnects on transient drops, so
// callers don't need a manual retry loop. Returns an unsubscribe fn.
//
// Errors (network drop, bad JSON) are swallowed silently — the caller's
// "last known price" cache holds the chart steady until ticks resume.
export function subscribeOtcTicks(
  assetId: string,
  onTick: (tick: OtcTick) => void,
): () => void {
  const url = `${API_URL.replace(/\/$/, '')}/otc/stream?assets=${encodeURIComponent(assetId)}`
  const es = new EventSource(url)

  es.addEventListener('tick', (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as OtcTick
      onTick(data)
    } catch {
      /* malformed payload — skip */
    }
  })

  return () => {
    try { es.close() } catch { /* already closed */ }
  }
}
