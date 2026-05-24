import type { Candle } from './marketTypes'

// Lightweight in-memory cache of fetched Binance candles. Keyed by
// (marketSymbol, interval) so 1m and 5m views of the same asset don't
// share entries.
//
// Purpose: make asset switching feel instant. The first time a user opens
// an asset we await the ~300-800ms fetch; switching back uses the cached
// data with zero network wait. The live tick interval picks up from the
// last cached candle's close — at worst, the first minute of "live" data
// extends an already-30s-old candle, which is invisible visually.
//
// TTL: 60s. Tight enough that admins debugging won't be confused by
// stale prices; loose enough that any normal tab-switching session
// benefits. Beyond 60s the catalog also gives the live interval a chance
// to drift far from reality (rare prices moves), so we'd rather pay the
// fetch cost than show ~1min of fake "flat" gap-fill.

interface Entry {
  candles:   Candle[]
  fetchedAt: number  // ms epoch
}

const cache = new Map<string, Entry>()
const TTL_MS = 60_000

function key(symbol: string, interval: string): string {
  return `${symbol}:${interval}`
}

export function getCachedCandles(symbol: string, interval: string): Candle[] | null {
  const entry = cache.get(key(symbol, interval))
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(key(symbol, interval))
    return null
  }
  return entry.candles
}

export function setCachedCandles(symbol: string, interval: string, candles: Candle[]): void {
  cache.set(key(symbol, interval), { candles, fetchedAt: Date.now() })
}

// Exposed for tests / future "force refresh" UI button.
export function clearCandleCache(): void {
  cache.clear()
}
