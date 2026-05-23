import { z } from 'zod'

export const MIN_DEPOSIT = 60     // R$ — keep in sync with frontend
export const MAX_DEPOSIT = 10_000 // R$

export const createPixDepositSchema = z.object({
  amount: z.number().positive().min(MIN_DEPOSIT).max(MAX_DEPOSIT).multipleOf(0.01),
})

export type CreatePixDepositInput = z.infer<typeof createPixDepositSchema>
