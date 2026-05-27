import { z } from 'zod'
import { getSettings } from '../settings/service.js'

export const createOperationSchema = z.object({
  accountId:        z.string().cuid(),
  assetId:          z.string().min(1),
  assetSymbol:      z.string().min(1),
  // Binance market symbol (e.g. "BTCUSDT") so backend can fetch the real exit price.
  // Optional — for non-Binance assets we fall back to a simulated price.
  marketSymbol:     z.string().min(1).optional(),
  direction:        z.enum(['CALL', 'PUT']),
  // Live limits from PlatformSettings — admin can tighten/loosen from
  // /admin/configuracoes without redeploying.
  amount:           z.number().positive().multipleOf(0.01).superRefine((v, ctx) => {
    const s = getSettings()
    if (v < s.operationMin) ctx.addIssue({ code: 'too_small', minimum: s.operationMin, type: 'number', inclusive: true, message: `Valor mínimo R$ ${s.operationMin.toFixed(2)}.` })
    if (v > s.operationMax) ctx.addIssue({ code: 'too_big',   maximum: s.operationMax, type: 'number', inclusive: true, message: `Valor máximo R$ ${s.operationMax.toFixed(2)}.` })
  }),
  payout:           z.number().int().min(1).max(99),
  entryPrice:       z.number().positive(),
  expiresInSeconds: z.union([z.literal(60), z.literal(300), z.literal(900)]),
})

export type CreateOperationInput = z.infer<typeof createOperationSchema>
