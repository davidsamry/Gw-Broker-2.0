import { z } from 'zod'
import { getSettings } from '../settings/service.js'

export const WITHDRAWAL_METHODS = ['PIX', 'USDT_TRC20', 'BANK_TRANSFER'] as const
// Fallback default — the live limits come from PlatformSettings.
export const MIN_WITHDRAWAL = 60

export const createWithdrawalSchema = z.object({
  accountId:   z.string().cuid(),
  amount:      z.number().positive().multipleOf(0.01).superRefine((v, ctx) => {
    const s = getSettings()
    if (v < s.withdrawalMin) ctx.addIssue({ code: 'too_small', minimum: s.withdrawalMin, type: 'number', inclusive: true, message: `Mínimo R$ ${s.withdrawalMin.toFixed(2)}.` })
    if (v > s.withdrawalMax) ctx.addIssue({ code: 'too_big',   maximum: s.withdrawalMax, type: 'number', inclusive: true, message: `Máximo R$ ${s.withdrawalMax.toFixed(2)}.` })
  }),
  method:      z.enum(WITHDRAWAL_METHODS),
  destination: z.string().min(3).max(200),  // PIX key / wallet / bank info
})

export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>
