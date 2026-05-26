import type { Asset } from '../market-types.js'

// Master catalog of Binance assets served by /market/assets?source=BINANCE.
// The frontend's loadMarketAssets() replaces its mockData ASSETS list with
// what this endpoint returns — so this file is the source of truth for
// which crypto pairs the user can trade.
//
// Must stay in sync with apps/web/src/lib/mockData.ts (same ids, symbols,
// marketSymbol, payout, category) so a user navigating from a saved tab
// (vx:openAssetIds in localStorage) doesn't hit a missing-asset fallback.
//
// All entries use data-api.binance.vision (free tier, no API key needed) —
// the marketSymbol field is what BinanceProvider passes to the ticker /
// kline endpoints. Adding a new pair: copy a row, change id/symbol/
// marketSymbol/icon/payout. No backend code change required.
export const BINANCE_SPOT_ASSETS: Asset[] = [
  // ── Tier 1: Top market cap (payout 95) ──────────────────────────────────
  {
    id: 'btc-usdt-binance', symbol: 'BTC/USDT', label: 'Bitcoin / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'BTCUSDT',
    payout: 95, payout5min: 95,
    flag1: '₿', flag2: 'USDT', code1: 'crypto:btc', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'eth-usdt-binance', symbol: 'ETH/USDT', label: 'Ethereum / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'ETHUSDT',
    payout: 95, payout5min: 95,
    flag1: 'Ξ', flag2: 'USDT', code1: 'crypto:eth', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'bnb-usdt-binance', symbol: 'BNB/USDT', label: 'BNB / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'BNBUSDT',
    payout: 95, payout5min: 95,
    flag1: '🪙', flag2: 'USDT', code1: 'crypto:bnb', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'sol-usdt-binance', symbol: 'SOL/USDT', label: 'Solana / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'SOLUSDT',
    payout: 95, payout5min: 95,
    flag1: '◎', flag2: 'USDT', code1: 'crypto:sol', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'xrp-usdt-binance', symbol: 'XRP/USDT', label: 'Ripple / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'XRPUSDT',
    payout: 95, payout5min: 95,
    flag1: '◉', flag2: 'USDT', code1: 'crypto:xrp', code2: 'us',
    price: 0, change24h: 0,
  },
  // ── Tier 2: High cap (payout 94) ────────────────────────────────────────
  {
    id: 'ada-usdt-binance', symbol: 'ADA/USDT', label: 'Cardano / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'ADAUSDT',
    payout: 94, payout5min: 94,
    flag1: '₳', flag2: 'USDT', code1: 'crypto:ada', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'doge-usdt-binance', symbol: 'DOGE/USDT', label: 'Dogecoin / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'DOGEUSDT',
    payout: 94, payout5min: 94,
    flag1: 'Ð', flag2: 'USDT', code1: 'crypto:doge', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'ltc-usdt-binance', symbol: 'LTC/USDT', label: 'Litecoin / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'LTCUSDT',
    payout: 94, payout5min: 94,
    flag1: 'Ł', flag2: 'USDT', code1: 'crypto:ltc', code2: 'us',
    price: 0, change24h: 0,
  },
  // ── Tier 3: Mid cap (payout 93) ─────────────────────────────────────────
  {
    id: 'dot-usdt-binance', symbol: 'DOT/USDT', label: 'Polkadot / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'DOTUSDT',
    payout: 93, payout5min: 93,
    flag1: '●', flag2: 'USDT', code1: 'crypto:dot', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'link-usdt-binance', symbol: 'LINK/USDT', label: 'Chainlink / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'LINKUSDT',
    payout: 93, payout5min: 93,
    flag1: '⬡', flag2: 'USDT', code1: 'crypto:link', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'bch-usdt-binance', symbol: 'BCH/USDT', label: 'Bitcoin Cash / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'BCHUSDT',
    payout: 93, payout5min: 93,
    flag1: '₿', flag2: 'USDT', code1: 'crypto:bch', code2: 'us',
    price: 0, change24h: 0,
  },
  // ── Tier 4: L1/L2 + DeFi (payout 92) ────────────────────────────────────
  {
    id: 'avax-usdt-binance', symbol: 'AVAX/USDT', label: 'Avalanche / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'AVAXUSDT',
    payout: 92, payout5min: 92,
    flag1: '🅰', flag2: 'USDT', code1: 'crypto:avax', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'trx-usdt-binance', symbol: 'TRX/USDT', label: 'TRON / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'TRXUSDT',
    payout: 92, payout5min: 92,
    flag1: '◈', flag2: 'USDT', code1: 'crypto:trx', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'ton-usdt-binance', symbol: 'TON/USDT', label: 'Toncoin / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'TONUSDT',
    payout: 92, payout5min: 92,
    flag1: '◎', flag2: 'USDT', code1: 'crypto:ton', code2: 'us',
    price: 0, change24h: 0,
  },
  // ── Tier 5: Memes + emerging (payout 90-91) ─────────────────────────────
  {
    id: 'shib-usdt-binance', symbol: 'SHIB/USDT', label: 'Shiba Inu / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'SHIBUSDT',
    payout: 91, payout5min: 91,
    flag1: '🐕', flag2: 'USDT', code1: 'crypto:shib', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'pepe-usdt-binance', symbol: 'PEPE/USDT', label: 'Pepe / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'PEPEUSDT',
    payout: 90, payout5min: 90,
    flag1: '🐸', flag2: 'USDT', code1: 'crypto:pepe', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'sui-usdt-binance', symbol: 'SUI/USDT', label: 'Sui / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'SUIUSDT',
    payout: 90, payout5min: 90,
    flag1: '◉', flag2: 'USDT', code1: 'crypto:sui', code2: 'us',
    price: 0, change24h: 0,
  },
  // ── Tier 6: DeFi + new L1/L2 (payout 89-90) ─────────────────────────────
  {
    id: 'aave-usdt-binance', symbol: 'AAVE/USDT', label: 'Aave / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'AAVEUSDT',
    payout: 90, payout5min: 90,
    flag1: '👻', flag2: 'USDT', code1: 'crypto:aave', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'uni-usdt-binance', symbol: 'UNI/USDT', label: 'Uniswap / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'UNIUSDT',
    payout: 90, payout5min: 90,
    flag1: '🦄', flag2: 'USDT', code1: 'crypto:uni', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'near-usdt-binance', symbol: 'NEAR/USDT', label: 'NEAR / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'NEARUSDT',
    payout: 89, payout5min: 89,
    flag1: '◯', flag2: 'USDT', code1: 'crypto:near', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'apt-usdt-binance', symbol: 'APT/USDT', label: 'Aptos / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'APTUSDT',
    payout: 89, payout5min: 89,
    flag1: '🅰', flag2: 'USDT', code1: 'crypto:apt', code2: 'us',
    price: 0, change24h: 0,
  },
  {
    id: 'arb-usdt-binance', symbol: 'ARB/USDT', label: 'Arbitrum / USDT',
    type: 'Crypto', category: 'Cripto', source: 'BINANCE', marketType: 'CRYPTO',
    executionVenue: 'BINANCE_SPOT', marketSymbol: 'ARBUSDT',
    payout: 89, payout5min: 89,
    flag1: '🔷', flag2: 'USDT', code1: 'crypto:arb', code2: 'us',
    price: 0, change24h: 0,
  },
]

export const OTC_DEFAULT_CONFIG = {
  spread: 0.0002,
  liquidity: 1,
  speed: 200,
  initialPrice: 1,
  volatility: 0.0008,
  trend: 0,
  trendStrength: 0.3,
  enabled: true,
}
