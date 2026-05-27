export type MarketType = 'OTC' | 'FOREX' | 'CRYPTO'
// MarketSource on Asset narrows what live-price/candle pipeline runs for
// a given pair. INTERNAL → OTC engine (server-priced), BINANCE → Binance
// kline WebSocket. The 'Forex' type union remains for OTC pairs that are
// FX-themed but priced internally.
export type MarketSource = 'INTERNAL' | 'BINANCE'
export type ExecutionVenue = 'OTC_INTERNAL' | 'BINANCE_SPOT'

export interface Asset {
  id: string
  symbol: string
  label: string
  type: 'OTC' | 'Forex' | 'Crypto'
  category: 'Moedas' | 'Cripto' | 'Matérias-Primas' | 'Ações'
  source?: MarketSource
  marketSymbol?: string
  marketType?: MarketType
  executionVenue?: ExecutionVenue
  payout: number
  payout5min: number
  flag1: string
  flag2: string
  code1: string
  code2: string
  price: number
  change24h: number
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface Tick {
  symbol: string
  price: number
  timestamp: number
  source: MarketSource
}

export interface Trade {
  id: string
  assetId: string
  assetSymbol: string
  direction: 'CALL' | 'PUT'
  amount: number
  payout: number
  entryPrice: number
  exitPrice?: number
  status: 'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  openedAt: number
  closedAt?: number
}

export interface LiquidityConfig {
  spread: number
  liquidity: number
  speed: number
}

export interface OTCConfig {
  initialPrice: number
  volatility: number
  trend: number
  trendStrength: number
  enabled: boolean
}

export interface BinanceConfig {
  symbol: string
  interval: string
  enabled: boolean
}
