import { z } from 'zod'
import { getSettings } from '../settings/service.js'

// Backwards-compatible exports — kept so any other module that imported
// these still compiles. The CANONICAL source is now the admin-editable
// PlatformSettings row (settings/service.ts). These are only the seeded
// fallback defaults used before the cache hydrates.
export const MIN_DEPOSIT = 60
export const MAX_DEPOSIT = 100_000

// CPF is 11 digits. We accept either bare digits or the masked form
// (000.000.000-00) and normalise to digits-only before persisting / sending
// to the gateway.
const CPF_DIGITS_RE = /^\d{11}$/
function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Amount range is read at parse time from the live settings cache so an
// admin edit on /admin/configuracoes takes effect immediately for the
// NEXT request (no API restart needed).
export const createPixDepositSchema = z.object({
  amount: z.number().positive().multipleOf(0.01).superRefine((v, ctx) => {
    const s = getSettings()
    if (v < s.depositMin) ctx.addIssue({ code: 'too_small', minimum: s.depositMin, type: 'number', inclusive: true, message: `Mínimo R$ ${s.depositMin.toFixed(2)}.` })
    if (v > s.depositMax) ctx.addIssue({ code: 'too_big',   maximum: s.depositMax, type: 'number', inclusive: true, message: `Máximo R$ ${s.depositMax.toFixed(2)}.` })
  }),
  // Required: payer's CPF. PIX charges go through BSPay's customer model
  // which requires the document. Accepts masked or bare; normalised here.
  cpf: z.string().transform(normalizeCpf).pipe(z.string().regex(CPF_DIGITS_RE, 'CPF deve ter 11 dígitos.')),
  // Optional bonus code (Fase B1). When supplied, the server validates it
  // and attaches a PENDING BonusGrant — flipped to ACTIVE + credited when
  // the webhook confirms the deposit.
  bonusCode: z.string().trim().min(2).max(32).optional(),
})

export type CreatePixDepositInput = z.infer<typeof createPixDepositSchema>
