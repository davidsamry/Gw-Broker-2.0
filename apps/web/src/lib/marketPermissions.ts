// Client-side mirror of apps/api/src/operations/marketPermissions.ts.
// Backend is the source of truth — this is purely for UX (hiding the
// trade buttons + showing "Mercado Fechado" when the user can't trade
// the on-screen asset's market). Server still enforces on POST.

import type { Asset } from './mockData'

export type Market = 'forex' | 'crypto' | 'otc'

/**
 * Resolve which market an asset belongs to. Mirrors the backend mapping
 * exactly so the UI shows "Mercado Fechado" iff the server would 403:
 *
 *   Binance asset (source=BINANCE)              → 'crypto'
 *   OTC asset, category 'Cripto' (CRYPTO)       → 'crypto'
 *   OTC asset, category 'Moedas'  (FOREX)       → 'forex'
 *   OTC asset, anything else                    → 'otc'
 *
 * The category field on Asset uses the frontend display labels
 * ('Moedas' / 'Cripto' / 'Matérias-Primas' / 'Ações') — those align
 * with the OtcCategory enum values in the DB (FOREX / CRYPTO /
 * COMMODITIES / INDICES).
 */
export function getAssetMarket(asset: Asset): Market {
  if (asset.source === 'BINANCE') return 'crypto'
  if (asset.category === 'Cripto') return 'crypto'
  if (asset.category === 'Moedas') return 'forex'
  return 'otc'
}

export interface MarketPerms {
  canTradeForex?:  boolean
  canTradeOtc?:    boolean
  canTradeCrypto?: boolean
}

/**
 * Fail-OPEN on missing data:
 *  - `perms` undefined/null (auth not hydrated yet)               → allow
 *  - Any individual flag missing (older cached payload pre-feature) → allow
 *
 * Avoids flashing "Mercado Fechado" during the first paint while the
 * /auth/me request is in flight. The server still enforces on POST, so
 * a permission flag added admin-side will catch the trade attempt even
 * if the UI hasn't refreshed yet.
 */
export function isMarketAllowed(perms: MarketPerms | undefined | null, market: Market): boolean {
  if (!perms) return true
  if (market === 'crypto') return perms.canTradeCrypto !== false
  if (market === 'forex')  return perms.canTradeForex  !== false
  return perms.canTradeOtc !== false
}

/** User-visible label for the closed-market banner. */
export function marketLabel(m: Market): string {
  if (m === 'crypto') return 'Cripto'
  if (m === 'forex')  return 'Forex'
  return 'OTC'
}
