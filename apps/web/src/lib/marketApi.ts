import { api } from './api'
import type { Asset, Candle } from './marketTypes'

export interface MarketTicker {
  symbol: string
  price: number
  change24h: number
  updatedAt: string
}

export async function fetchMarketAssets(source?: 'BINANCE' | 'INTERNAL') {
  const { data } = await api.get<{ assets: Asset[] }>('/market/assets', {
    params: source ? { source } : undefined,
  })
  return data.assets
}

export async function fetchBinanceTicker(symbol: string) {
  const { data } = await api.get<{ ticker: MarketTicker }>('/market/binance/ticker', {
    params: { symbol },
  })
  return data.ticker
}

// Default 1000 = Binance's per-request max. Gives the chart ~16h of 1m
// history (or ~6 weeks of 1h), enough that scrolling back rarely needs
// pagination. Payload at 1000 candles is ~80KB JSON — still trivial.
export async function fetchBinanceCandles(symbol: string, interval = '1m', limit = 1000) {
  const { data } = await api.get<{ candles: Candle[] }>('/market/binance/candles', {
    params: { symbol, interval, limit },
  })
  return data.candles
}
