import { z } from 'zod'

export const MIN_DEPOSIT = 60     // R$ — keep in sync with frontend
export const MAX_DEPOSIT = 10_000 // R$

export const createPixDepositSchema = z.object({
  amount: z.number().positive().min(MIN_DEPOSIT).max(MAX_DEPOSIT).multipleOf(0.01),
  // Optional bonus code (Fase B1). When supplied, the server validates it
  // and attaches a PENDING BonusGrant — flipped to ACTIVE + credited when
  // the webhook confirms the deposit.
  bonusCode: z.string().trim().min(2).max(32).optional(),
})

export type CreatePixDepositInput = z.infer<typeof createPixDepositSchema>
