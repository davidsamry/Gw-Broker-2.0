// Per-user market permission gate. Admin toggles canTradeForex /
// canTradeOtc / canTradeCrypto on /admin/usuarios. When any is FALSE,
// createOperation refuses with MARKET_NOT_ALLOWED so the user can't
// trade that market (UI shows "Mercado Fechado" message).
//
// Mapping (single source of truth — frontend mirrors this same logic
// in apps/web/src/lib/marketPermissions.ts):
//
//   Binance (source=BINANCE, marketSymbol set)     → 'crypto'
//   OTC asset, otc_assets.category = CRYPTO        → 'crypto'
//   OTC asset, otc_assets.category = FOREX         → 'forex'
//   OTC asset, anything else (COMMODITIES, etc.)   → 'otc'

import { prisma } from '../prisma.js'

export type Market = 'forex' | 'crypto' | 'otc'

/**
 * Resolve which market the asset belongs to. Single DB hit when the
 * asset is OTC, zero hits when it's Binance (we use the marketSymbol
 * presence as the BINANCE signal — saves the trip).
 */
export async function getAssetMarket(asset: {
  id:            string
  marketSymbol?: string | null
}): Promise<Market> {
  if (asset.marketSymbol) return 'crypto'
  const rows = await prisma.$queryRaw<Array<{ category: string }>>`
    SELECT category::text AS category FROM otc_assets WHERE id = ${asset.id} LIMIT 1
  `
  const cat = rows[0]?.category
  if (cat === 'CRYPTO') return 'crypto'
  if (cat === 'FOREX')  return 'forex'
  return 'otc'   // COMMODITIES / INDICES / STOCKS / unknown
}

export interface MarketPerms {
  canTradeForex:  boolean
  canTradeOtc:    boolean
  canTradeCrypto: boolean
}

export function isMarketAllowed(perms: MarketPerms, market: Market): boolean {
  if (market === 'crypto') return perms.canTradeCrypto
  if (market === 'forex')  return perms.canTradeForex
  return perms.canTradeOtc
}

/**
 * Fetches the 3 flags for a user in one query. Returns all-true defaults
 * if the user row isn't found (fail-open — never accidentally block).
 */
export async function getUserMarketPerms(userId: string): Promise<MarketPerms> {
  const rows = await prisma.$queryRaw<MarketPerms[]>`
    SELECT "canTradeForex", "canTradeOtc", "canTradeCrypto"
    FROM users WHERE id = ${userId} LIMIT 1
  `
  const row = rows[0]
  if (!row) return { canTradeForex: true, canTradeOtc: true, canTradeCrypto: true }
  return row
}

/**
 * Combined check — convenience wrapper used by createOperation and the
 * bot trade endpoint. Throws Error('MARKET_NOT_ALLOWED:<market>') when
 * blocked. Caller maps to HTTP 403 with the market in the response so
 * the UI can render the right "Mercado Fechado" message.
 */
export async function assertMarketAllowed(userId: string, asset: {
  id:            string
  marketSymbol?: string | null
}): Promise<void> {
  const [perms, market] = await Promise.all([
    getUserMarketPerms(userId),
    getAssetMarket(asset),
  ])
  if (!isMarketAllowed(perms, market)) {
    throw new Error(`MARKET_NOT_ALLOWED:${market}`)
  }
}
