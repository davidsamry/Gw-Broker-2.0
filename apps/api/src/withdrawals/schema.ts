import { z } from 'zod'

export const WITHDRAWAL_METHODS = ['PIX', 'USDT_TRC20', 'BANK_TRANSFER'] as const
export const MIN_WITHDRAWAL = 60  // R$ — keep in sync with UI footer text

export const createWithdrawalSchema = z.object({
  accountId:   z.string().cuid(),
  amount:      z.number().positive().min(MIN_WITHDRAWAL).multipleOf(0.01),
  method:      z.enum(WITHDRAWAL_METHODS),
  destination: z.string().min(3).max(200),  // PIX key / wallet / bank info
})

export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>
