import { z } from 'zod'

export const createOperationSchema = z.object({
  accountId:        z.string().cuid(),
  assetId:          z.string().min(1),
  assetSymbol:      z.string().min(1),
  // Binance market symbol (e.g. "BTCUSDT") so backend can fetch the real exit price.
  // Optional — for non-Binance assets we fall back to a simulated price.
  marketSymbol:     z.string().min(1).optional(),
  direction:        z.enum(['CALL', 'PUT']),
  amount:           z.number().positive().multipleOf(0.01),
  payout:           z.number().int().min(1).max(99),
  entryPrice:       z.number().positive(),
  expiresInSeconds: z.union([z.literal(60), z.literal(300), z.literal(900)]),
})

export type CreateOperationInput = z.infer<typeof createOperationSchema>
