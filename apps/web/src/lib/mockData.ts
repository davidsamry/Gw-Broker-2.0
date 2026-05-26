import { type Asset, type Candle } from './marketTypes'

export type { Asset, Candle } from './marketTypes'

export interface ActiveTrade {
  id: string
  entryPrice: number
  entryTime: number
  expiryTime: number
  direction: 'CALL' | 'PUT'
  amount: number
  payout: number
}

export interface ChartTradeEvent {
  id: string
  entryPrice: number
  entryTime: number
  expiryTime: number
  direction: 'CALL' | 'PUT'
  amount: number
  payout: number
  // OPEN     → optimistic marker placed on chart
  // RESOLVED → server returned WON/LOST/CANCELLED, shows result marker
  // CANCELLED→ optimistic placement failed (server error); silently remove
  status: 'OPEN' | 'RESOLVED' | 'CANCELLED'
  won?: boolean
  profit?: number
}

// Catalog: 22 Binance-priced crypto + 5 OTC v2 server-priced assets.
// Binance entries point at marketSymbol so the chart uses the Binance kline
// WebSocket. OTC entries have no marketSymbol or source — the chart routes
// these to the new OTC engine via /otc/stream (Etapa 4 onwards).
// Adding/removing assets here must stay in sync with the DB (otc_assets +
// Binance catalog) so admin and pricing engine see the same list.
export const ASSETS: Asset[] = [
  // ── OTC v2 — server-priced (Etapa 2 onwards) ────────────────────────────
  // During Etapa 1 these appear in the asset selector but the chart will
  // fall back to mock candles since the engine isn't wired yet. Wiring
  // lands in Etapa 4 (chart consumes new stream).
  { id: 'eur-usd-otc', symbol: 'EUR/USD', label: 'EUR/USD (OTC)', type: 'OTC', category: 'Moedas',          payout: 85, payout5min: 85, flag1: '🇪🇺', flag2: '🇺🇸', code1: 'eu', code2: 'us', price: 1.08500,  change24h: 0 },
  { id: 'gbp-jpy-otc', symbol: 'GBP/JPY', label: 'GBP/JPY (OTC)', type: 'OTC', category: 'Moedas',          payout: 87, payout5min: 87, flag1: '🇬🇧', flag2: '🇯🇵', code1: 'gb', code2: 'jp', price: 198.50,   change24h: 0 },
  { id: 'btc-usd-otc', symbol: 'BTC/USD', label: 'BTC/USD (OTC)', type: 'OTC', category: 'Cripto',          payout: 82, payout5min: 82, flag1: '₿',  flag2: '🇺🇸', code1: 'crypto:btc', code2: 'us', price: 68000, change24h: 0 },
  { id: 'gold-otc',    symbol: 'GOLD',    label: 'GOLD (OTC)',    type: 'OTC', category: 'Matérias-Primas', payout: 80, payout5min: 80, flag1: '🥇', flag2: '🇺🇸', code1: 'us', code2: 'us', price: 2350,    change24h: 0 },
  { id: 'nasdaq-otc',  symbol: 'NASDAQ',  label: 'NASDAQ (OTC)',  type: 'OTC', category: 'Ações',           payout: 78, payout5min: 78, flag1: '📊', flag2: '🇺🇸', code1: 'us', code2: 'us', price: 18450,   change24h: 0 },

  // ── Binance crypto (live kline WS) ──────────────────────────────────────
  { id: 'btc-usdt-binance', symbol: 'BTC/USDT', label: 'Bitcoin / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'BTCUSDT', category: 'Cripto', payout: 95, payout5min: 95, flag1: '₿', flag2: 'USDT', code1: 'crypto:btc', code2: 'us', price: 67420.15, change24h: 1.24 },
  { id: 'eth-usdt-binance', symbol: 'ETH/USDT', label: 'Ethereum / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'ETHUSDT', category: 'Cripto', payout: 95, payout5min: 95, flag1: 'Ξ', flag2: 'USDT', code1: 'crypto:eth', code2: 'us', price: 3521.42, change24h: 0.86 },
  { id: 'bnb-usdt-binance', symbol: 'BNB/USDT', label: 'BNB / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'BNBUSDT', category: 'Cripto', payout: 95, payout5min: 95, flag1: '🪙', flag2: 'USDT', code1: 'crypto:bnb', code2: 'us', price: 612.38, change24h: -0.11 },
  { id: 'sol-usdt-binance', symbol: 'SOL/USDT', label: 'Solana / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'SOLUSDT', category: 'Cripto', payout: 95, payout5min: 95, flag1: '◎', flag2: 'USDT', code1: 'crypto:sol', code2: 'us', price: 172.41, change24h: 4.25 },
  { id: 'xrp-usdt-binance', symbol: 'XRP/USDT', label: 'Ripple / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'XRPUSDT', category: 'Cripto', payout: 95, payout5min: 95, flag1: '◉', flag2: 'USDT', code1: 'crypto:xrp', code2: 'us', price: 0.5124, change24h: 7.50 },
  { id: 'ada-usdt-binance', symbol: 'ADA/USDT', label: 'Cardano / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'ADAUSDT', category: 'Cripto', payout: 94, payout5min: 94, flag1: '₳', flag2: 'USDT', code1: 'crypto:ada', code2: 'us', price: 0.4522, change24h: 2.34 },
  { id: 'doge-usdt-binance', symbol: 'DOGE/USDT', label: 'Dogecoin / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'DOGEUSDT', category: 'Cripto', payout: 94, payout5min: 94, flag1: 'Ð', flag2: 'USDT', code1: 'crypto:doge', code2: 'us', price: 0.1622, change24h: -1.87 },
  { id: 'ltc-usdt-binance', symbol: 'LTC/USDT', label: 'Litecoin / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'LTCUSDT', category: 'Cripto', payout: 94, payout5min: 94, flag1: 'Ł', flag2: 'USDT', code1: 'crypto:ltc', code2: 'us', price: 84.53, change24h: -4.84 },
  { id: 'dot-usdt-binance', symbol: 'DOT/USDT', label: 'Polkadot / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'DOTUSDT', category: 'Cripto', payout: 93, payout5min: 93, flag1: '●', flag2: 'USDT', code1: 'crypto:dot', code2: 'us', price: 7.43, change24h: -9.66 },
  { id: 'link-usdt-binance', symbol: 'LINK/USDT', label: 'Chainlink / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'LINKUSDT', category: 'Cripto', payout: 93, payout5min: 93, flag1: '⬡', flag2: 'USDT', code1: 'crypto:link', code2: 'us', price: 14.33, change24h: -6.67 },
  { id: 'bch-usdt-binance', symbol: 'BCH/USDT', label: 'Bitcoin Cash / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'BCHUSDT', category: 'Cripto', payout: 93, payout5min: 93, flag1: '₿', flag2: 'USDT', code1: 'crypto:bch', code2: 'us', price: 484.21, change24h: -0.32 },
  { id: 'avax-usdt-binance', symbol: 'AVAX/USDT', label: 'Avalanche / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'AVAXUSDT', category: 'Cripto', payout: 92, payout5min: 92, flag1: '🅰', flag2: 'USDT', code1: 'crypto:avax', code2: 'us', price: 37.18, change24h: 3.61 },
  { id: 'trx-usdt-binance', symbol: 'TRX/USDT', label: 'TRON / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'TRXUSDT', category: 'Cripto', payout: 92, payout5min: 92, flag1: '◈', flag2: 'USDT', code1: 'crypto:trx', code2: 'us', price: 0.1321, change24h: 1.08 },
  { id: 'ton-usdt-binance', symbol: 'TON/USDT', label: 'Toncoin / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'TONUSDT', category: 'Cripto', payout: 92, payout5min: 92, flag1: '◎', flag2: 'USDT', code1: 'crypto:ton', code2: 'us', price: 6.81, change24h: 2.07 },
  { id: 'shib-usdt-binance', symbol: 'SHIB/USDT', label: 'Shiba Inu / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'SHIBUSDT', category: 'Cripto', payout: 91, payout5min: 91, flag1: '🐕', flag2: 'USDT', code1: 'crypto:shib', code2: 'us', price: 0.00002431, change24h: 1.91 },
  { id: 'pepe-usdt-binance', symbol: 'PEPE/USDT', label: 'Pepe / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'PEPEUSDT', category: 'Cripto', payout: 90, payout5min: 90, flag1: '🐸', flag2: 'USDT', code1: 'crypto:pepe', code2: 'us', price: 0.00001128, change24h: 12.42 },
  { id: 'sui-usdt-binance', symbol: 'SUI/USDT', label: 'Sui / USDT', type: 'Crypto', source: 'BINANCE', marketSymbol: 'SUIUSDT', category: 'Cripto', payout: 90, payout5min: 90, flag1: '◉', flag2: 'USDT', code1: 'crypto:sui', code2: 'us', price: 1.72, change24h: 5.33 },
  // ── New batch: 5 high-liquidity Binance pairs (DeFi + L1/L2) ────────────
  // All present on data-api.binance.vision (the same endpoint BinanceProvider
  // already uses) and have coincap icons. No backend changes needed —
  // catalog is frontend-driven for Binance assets.
  { id: 'aave-usdt-binance', symbol: 'AAVE/USDT', label: 'Aave / USDT',       type: 'Crypto', source: 'BINANCE', marketSymbol: 'AAVEUSDT', category: 'Cripto', payout: 90, payout5min: 90, flag1: '👻', flag2: 'USDT', code1: 'crypto:aave', code2: 'us', price: 95.40,  change24h: 0 },
  { id: 'uni-usdt-binance',  symbol: 'UNI/USDT',  label: 'Uniswap / USDT',    type: 'Crypto', source: 'BINANCE', marketSymbol: 'UNIUSDT',  category: 'Cripto', payout: 90, payout5min: 90, flag1: '🦄', flag2: 'USDT', code1: 'crypto:uni',  code2: 'us', price: 8.71,   change24h: 0 },
  { id: 'near-usdt-binance', symbol: 'NEAR/USDT', label: 'NEAR / USDT',       type: 'Crypto', source: 'BINANCE', marketSymbol: 'NEARUSDT', category: 'Cripto', payout: 89, payout5min: 89, flag1: '◯',  flag2: 'USDT', code1: 'crypto:near', code2: 'us', price: 4.23,   change24h: 0 },
  { id: 'apt-usdt-binance',  symbol: 'APT/USDT',  label: 'Aptos / USDT',      type: 'Crypto', source: 'BINANCE', marketSymbol: 'APTUSDT',  category: 'Cripto', payout: 89, payout5min: 89, flag1: '🅰',  flag2: 'USDT', code1: 'crypto:apt',  code2: 'us', price: 7.50,   change24h: 0 },
  { id: 'arb-usdt-binance',  symbol: 'ARB/USDT',  label: 'Arbitrum / USDT',   type: 'Crypto', source: 'BINANCE', marketSymbol: 'ARBUSDT',  category: 'Cripto', payout: 89, payout5min: 89, flag1: '🔷', flag2: 'USDT', code1: 'crypto:arb',  code2: 'us', price: 0.80,   change24h: 0 },
]

export const DEFAULT_FAVORITES = [
  'btc-usdt-binance', 'eth-usdt-binance', 'bnb-usdt-binance', 'sol-usdt-binance',
  'xrp-usdt-binance', 'ada-usdt-binance', 'doge-usdt-binance', 'ltc-usdt-binance',
]


const BRT_OFFSET = -3 * 3600 // UTC-3 (Horário de Brasília)

export function generateMockCandles(basePrice = 158.92, count = 120, interval = 60): Candle[] {
  const candles: Candle[] = []
  // Usa timestamp BRT para que o eixo de tempo exiba horário de Brasília
  const now = Math.floor(Date.now() / 1000) + BRT_OFFSET
  const alignedNow = Math.floor(now / interval) * interval

  let price = basePrice * (1 + (Math.random() - 0.5) * 0.02) // slight start variance
  let trend = (Math.random() - 0.5) * 0.3
  let trendAge = 0
  const vol = basePrice * 0.0008 // volatility relative to price

  for (let i = count; i >= 1; i--) {
    // Evolve trend
    trendAge++
    if (trendAge > 8 + Math.floor(Math.random() * 12)) {
      trend = (Math.random() - 0.5) * 0.4
      trendAge = 0
    }
    // Mean reversion nudge
    trend += (basePrice - price) / basePrice * 0.15

    const open = price
    // Simulate ticks inside candle
    let lo = open, hi = open
    for (let t = 0; t < 8; t++) {
      price += trend * vol + (Math.random() - 0.5) * vol * 1.5
      if (price < lo) lo = price
      if (price > hi) hi = price
    }
    const close = price
    const wicks = vol * (0.3 + Math.random() * 0.5)
    const high = parseFloat((hi + wicks).toFixed(5))
    const low  = parseFloat((lo  - wicks).toFixed(5))

    candles.push({
      time: alignedNow - i * interval,
      open: parseFloat(open.toFixed(5)),
      high,
      low,
      close: parseFloat(close.toFixed(5)),
    })
  }

  return candles
}

export interface OpenTrade {
  id: string
  asset: Asset
  direction: 'CALL' | 'PUT'
  amount: number
  profit: number
  timeLeft: number
  entryPrice: number
  expiryTime: number  // BRT-shifted epoch seconds — used for regressive countdown
}

export interface ClosedTrade {
  id:          string
  assetSymbol: string
  code1:       string
  code2:       string
  direction:   'CALL' | 'PUT'
  amount:      number
  profit:      number
  status:      'WON' | 'LOST' | 'CANCELLED'
  closedAt:    string
}

