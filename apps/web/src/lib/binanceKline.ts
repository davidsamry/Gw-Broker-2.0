// Binance kline WebSocket subscription. Replaces the per-second
// setInterval + ticker WS pair that synthesised candle updates from a
// scalar price — kline_<interval> delivers the FULL OHLC of the current
// open candle on every trade (sub-second). The chart can call
// mainSeries.update() with each event and stay perfectly in sync with
// Binance's official candle, no local interpolation needed.
//
// Binance's payload (data.k):
//   t  open time in ms UTC
//   o  open price (string)
//   h  high
//   l  low
//   c  close (= live price)
//   x  true when this candle has closed (next message starts a new candle)
//
// We expose seconds + numbers so callers don't have to massage. The
// returned unsubscribe closes the socket; EventSource-style auto-reconnect
// is NOT built in — the caller's effect cleanup is the only teardown.

export interface KlineUpdate {
  /** open time in epoch seconds, UTC */
  time:     number
  open:     number
  high:     number
  low:      number
  /** live price within this candle's window */
  close:    number
  /** true on the message where the candle finalises (one per period) */
  isClosed: boolean
}

const BINANCE_WS_BASE = 'wss://data-stream.binance.vision/ws'

export function subscribeKline(
  symbol:   string,
  interval: string,                       // '1m' | '5m' | '15m' | '1h' | ...
  onUpdate: (k: KlineUpdate) => void,
): () => void {
  const url = `${BINANCE_WS_BASE}/${symbol.toLowerCase()}@kline_${interval}`
  let closed = false
  let ws: WebSocket | null = null
  // Single retry handle so reconnect logic doesn't pile up timers.
  let retryHandle: ReturnType<typeof setTimeout> | null = null
  let retryDelayMs = 1000  // backoff caps at 30s

  function connect() {
    try {
      ws = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      retryDelayMs = 1000  // reset backoff on a successful connect
    }

    ws.onmessage = (ev) => {
      if (closed) return
      try {
        const data = JSON.parse(ev.data as string)
        const k = data?.k
        if (!k) return
        const close = Number(k.c)
        if (!Number.isFinite(close)) return
        onUpdate({
          time:     Math.floor(Number(k.t) / 1000),
          open:     Number(k.o),
          high:     Number(k.h),
          low:      Number(k.l),
          close,
          isClosed: k.x === true,
        })
      } catch {
        /* malformed frame — skip */
      }
    }

    ws.onclose = () => {
      if (!closed) scheduleReconnect()
    }
    ws.onerror = () => {
      if (ws?.readyState === WebSocket.OPEN) return
      // Will trigger onclose, which queues reconnect. Don't double-schedule.
    }
  }

  function scheduleReconnect() {
    if (closed || retryHandle) return
    retryHandle = setTimeout(() => {
      retryHandle = null
      if (closed) return
      connect()
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000)
    }, retryDelayMs)
  }

  connect()

  return () => {
    closed = true
    if (retryHandle) { clearTimeout(retryHandle); retryHandle = null }
    try { ws?.close() } catch { /* already closed */ }
    ws = null
  }
}
