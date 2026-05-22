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

export async function fetchBinanceCandles(symbol: string, interval = '1m', limit = 150) {
  const { data } = await api.get<{ candles: Candle[] }>('/market/binance/candles', {
    params: { symbol, interval, limit },
  })
  return data.candles
}
