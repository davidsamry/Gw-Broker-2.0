'use client'

import { useEffect, useState } from 'react'
import { fetchBinanceTicker } from './marketApi'

const BINANCE_WS_BASE = 'wss://data-stream.binance.vision/ws'

export interface BinanceTicker {
  price: number
  change24h: number
  updatedAt: number
}

export function useBinanceTicker(marketSymbol?: string) {
  const [ticker, setTicker] = useState<BinanceTicker | null>(null)

  useEffect(() => {
    if (!marketSymbol) {
      setTicker(null)
      return
    }

    const symbol = marketSymbol
    let closed = false
    let pollId: ReturnType<typeof setInterval> | null = null

    async function loadTickerFromApi() {
      try {
        const data = await fetchBinanceTicker(symbol)
        if (closed) return
        setTicker({
          price: data.price,
          change24h: data.change24h,
          updatedAt: Date.parse(data.updatedAt) || Date.now(),
        })
      } catch {
        if (!closed) setTicker(null)
      }
    }

    loadTickerFromApi()

    const ws = new WebSocket(`${BINANCE_WS_BASE}/${marketSymbol.toLowerCase()}@ticker`)

    ws.onmessage = (event) => {
      if (closed) return
      const data = JSON.parse(event.data as string) as { c?: string; P?: string; E?: number }
      const price = Number(data.c)
      if (!Number.isFinite(price)) return

      setTicker({
        price,
        change24h: Number(data.P ?? 0),
        updatedAt: Number(data.E ?? Date.now()),
      })
    }

    ws.onerror = () => {
      if (closed) return
      if (!pollId) {
        loadTickerFromApi()
        pollId = setInterval(loadTickerFromApi, 5000)
      }
    }

    return () => {
      closed = true
      ws.close()
      if (pollId) clearInterval(pollId)
    }
  }, [marketSymbol])

  return ticker
}
