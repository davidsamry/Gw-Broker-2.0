import { z } from 'zod'

export const MIN_DEPOSIT = 60       // R$ — keep in sync with frontend
export const MAX_DEPOSIT = 100_000  // R$ — bumped 2026-05-25 per founder request

// CPF is 11 digits. We accept either bare digits or the masked form
// (000.000.000-00) and normalise to digits-only before persisting / sending
// to the gateway.
const CPF_DIGITS_RE = /^\d{11}$/
function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, '')
}

export const createPixDepositSchema = z.object({
  amount: z.number().positive().min(MIN_DEPOSIT).max(MAX_DEPOSIT).multipleOf(0.01),
  // Required: payer's CPF. PIX charges go through BSPay's customer model
  // which requires the document. Accepts masked or bare; normalised here.
  cpf: z.string().transform(normalizeCpf).pipe(z.string().regex(CPF_DIGITS_RE, 'CPF deve ter 11 dígitos.')),
  // Optional bonus code (Fase B1). When supplied, the server validates it
  // and attaches a PENDING BonusGrant — flipped to ACTIVE + credited when
  // the webhook confirms the deposit.
  bonusCode: z.string().trim().min(2).max(32).optional(),
})

export type CreatePixDepositInput = z.infer<typeof createPixDepositSchema>
