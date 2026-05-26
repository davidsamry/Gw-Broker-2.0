import type { Asset } from '../market-types.js'
import type { BinanceTicker } from './schema.js'
import { BINANCE_SPOT_ASSETS } from './catalog.js'
import { mapBinanceKlines, mapBinanceTicker, mergeAssetWithTicker } from './mapper.js'
import { prisma } from '../prisma.js'

const BINANCE_REST_BASE = 'https://data-api.binance.vision'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`MARKET_FETCH_FAILED:${response.status}`)
  }
  return response.json() as Promise<T>
}

// Cross-references the hardcoded catalog with the DB `assets` table so the
// user-facing selector respects admin's enable/disable toggles + payout
// edits. Entries with NO matching DB row stay visible with catalog
// defaults (backward compat: new pairs added to catalog.ts work without
// requiring an admin to seed them first).
export async function listBinanceAssets(): Promise<Asset[]> {
  // Fan-out two reads in parallel — Binance 24h tickers and our local DB
  // overrides. Both are bounded (~200ms p50 + ~5ms p50 respectively).
  const [tickers, dbRows] = await Promise.all([
    fetchJson<Record<string, unknown>[]>(`${BINANCE_REST_BASE}/api/v3/ticker/24hr`),
    prisma.$queryRaw<Array<{ id: string; enabled: boolean; payout: number }>>`
      SELECT id, enabled, payout FROM assets
      WHERE id = ANY(${BINANCE_SPOT_ASSETS.map((a) => a.id)}::text[])
    `,
  ])

  const tickerEntries: Array<[string, BinanceTicker]> = tickers
    .map((item) => mapBinanceTicker(item))
    .filter((item) => item.symbol)
    .map((item) => [item.symbol, item])
  const tickerMap = new Map<string, BinanceTicker>(tickerEntries)

  // Map<id, {enabled, payout}> — only entries the admin has explicitly
  // touched are here. Lookup miss = entry not yet seeded → show as-is.
  const dbMap = new Map(dbRows.map((r) => [r.id, r]))

  const out: Asset[] = []
  for (const asset of BINANCE_SPOT_ASSETS) {
    const dbOverride = dbMap.get(asset.id)
    // Admin explicitly disabled → hide from selector entirely.
    if (dbOverride && !dbOverride.enabled) continue

    // Apply DB payout override if admin set one (different from catalog).
    const merged: Asset = dbOverride
      ? { ...asset, payout: dbOverride.payout, payout5min: dbOverride.payout }
      : asset

    const ticker = tickerMap.get(merged.marketSymbol ?? '')
    out.push(ticker ? mergeAssetWithTicker(merged, ticker) : merged)
  }
  return out
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
