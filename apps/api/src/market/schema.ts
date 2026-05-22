import { z } from 'zod'

export const binanceCandlesQuerySchema = z.object({
  symbol: z.string().min(1),
  interval: z.string().min(1).default('1m'),
  limit: z.coerce.number().int().min(1).max(500).default(120),
})

export const binanceTickerQuerySchema = z.object({
  symbol: z.string().min(1),
})

export const marketAssetsQuerySchema = z.object({
  source: z.enum(['BINANCE', 'INTERNAL']).optional(),
})

export const binanceCandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
})

export const binanceTickerSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  change24h: z.number(),
  updatedAt: z.string(),
})

export type BinanceCandlesQuery = z.infer<typeof binanceCandlesQuerySchema>
export type BinanceTickerQuery = z.infer<typeof binanceTickerQuerySchema>
export type MarketAssetsQuery = z.infer<typeof marketAssetsQuerySchema>
export type BinanceCandle = z.infer<typeof binanceCandleSchema>
export type BinanceTicker = z.infer<typeof binanceTickerSchema>
