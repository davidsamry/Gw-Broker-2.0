import { z } from 'zod'

export const binancePricesQuerySchema = z.object({
  symbols: z.string().min(1),
})

export const binancePriceItemSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  change24h: z.number(),
  updatedAt: z.string(),
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

export type BinancePriceItem = z.infer<typeof binancePriceItemSchema>
export type BinancePricesQuery = z.infer<typeof binancePricesQuerySchema>
export type BinanceCandle = z.infer<typeof binanceCandleSchema>
export type BinanceTicker = z.infer<typeof binanceTickerSchema>
