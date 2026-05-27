export type MarketType = 'OTC' | 'FOREX' | 'CRYPTO'
// 'FOREX' added when cTrader integration shipped — assets with this
// source route through useForexLivePrice + fetchForexCandles instead of
// the OTC engine. Default fallthrough (no source) still means OTC.
export type MarketSource = 'INTERNAL' | 'BINANCE' | 'FOREX'
export type ExecutionVenue = 'OTC_INTERNAL' | 'BINANCE_SPOT' | 'FOREX_CTRADER'

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
