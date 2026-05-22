import type { Asset } from '../market-types.js'
import type { BinanceTicker } from './schema.js'
import { BINANCE_SPOT_ASSETS } from './catalog.js'
import { mapBinanceKlines, mapBinanceTicker, mergeAssetWithTicker } from './mapper.js'

const BINANCE_REST_BASE = 'https://data-api.binance.vision'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`MARKET_FETCH_FAILED:${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function listBinanceAssets(): Promise<Asset[]> {
  const tickers = await fetchJson<Record<string, unknown>[]>(`${BINANCE_REST_BASE}/api/v3/ticker/24hr`)
  const tickerEntries: Array<[string, BinanceTicker]> = tickers
    .map((item) => mapBinanceTicker(item))
    .filter((item) => item.symbol)
    .map((item) => [item.symbol, item])

  const tickerMap = new Map<string, BinanceTicker>(tickerEntries)

  return BINANCE_SPOT_ASSETS.map((asset) => {
    const ticker = tickerMap.get(asset.marketSymbol ?? '')
    return ticker ? mergeAssetWithTicker(asset, ticker) : asset
  })
}

export async function getBinanceTicker(symbol: string) {
  const raw = await fetchJson<Record<string, unknown>>(`${BINANCE_REST_BASE}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`)
  return mapBinanceTicker(raw)
}

export async function getBinanceCandles(symbol: string, interval: string, limit: number) {
  const raw = await fetchJson<unknown[]>(`${BINANCE_REST_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`)
  return mapBinanceKlines(raw)
}

export function listInternalAssets(): Asset[] {
  return []
}
