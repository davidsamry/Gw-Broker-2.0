import type { Asset } from '../market-types.js'
import type { BinanceCandle, BinanceTicker } from './schema.js'

export function mapBinanceKlines(raw: unknown[]): BinanceCandle[] {
  return raw.map((row) => {
    const [openTime, open, high, low, close] = row as [number, string, string, string, string]
    return {
      time: Math.floor(openTime / 1000),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
    }
  })
}

export function mapBinanceTicker(raw: Record<string, unknown>): BinanceTicker {
  return {
    symbol: String(raw.symbol ?? ''),
    price: Number(raw.lastPrice ?? raw.price ?? 0),
    change24h: Number(raw.priceChangePercent ?? 0),
    updatedAt: new Date(Number(raw.closeTime ?? Date.now())).toISOString(),
  }
}

export function mergeAssetWithTicker(asset: Asset, ticker: BinanceTicker): Asset {
  return {
    ...asset,
    marketSymbol: ticker.symbol,
    price: ticker.price,
    change24h: ticker.change24h,
  }
}
