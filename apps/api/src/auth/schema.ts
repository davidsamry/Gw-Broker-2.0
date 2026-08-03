import { z } from 'zod'

// CPF stored as 11 raw digits — frontend strips the mask before sending.
// We re-strip server-side defensively in case a client forgets, then
// validate the checksum so typos (000.000.000-00 style) are rejected.
export const registerSchema = z.object({
  name:     z.string().min(2).max(80).trim(),
  // Coletados no cadastro (enriquecem os webhooks de tracking). lastName e
  // phone opcionais no schema pra não quebrar clients antigos; o form pede.
  lastName: z.string().max(80).trim().optional(),
  phone:    z.string().max(30).trim().optional(),
  country:  z.string().max(60).trim().optional(),
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(6).max(72),
  cpf:      z.string()
              .transform(s => s.replace(/\D/g, ''))
              .refine(s => s.length === 11, 'CPF deve ter 11 dígitos.')
              .refine(isValidCpfChecksum, 'CPF inválido.'),
  // Optional Meta Conversions API attribution. Frontend captures fbp/
  // fbc/utm from cookies + query string and forwards them here so the
  // server-side CompleteRegistration event has full attribution context.
  // ALL optional — absence just degrades attribution quality, never blocks
  // registration.
  tracking: z.object({
    fbp:         z.string().max(200).optional().nullable(),
    fbc:         z.string().max(200).optional().nullable(),
    fbclid:      z.string().max(200).optional().nullable(),
    sck:         z.string().max(200).optional().nullable(),
    utmSource:   z.string().max(200).optional().nullable(),
    utmMedium:   z.string().max(200).optional().nullable(),
    utmCampaign: z.string().max(200).optional().nullable(),
    utmContent:  z.string().max(200).optional().nullable(),
    utmTerm:     z.string().max(200).optional().nullable(),
  }).optional(),
})

// Standard Brazilian CPF mod-11 checksum. Rejects strings of repeated
// digits (00000000000, 11111111111…) which pass the formula but are
// commonly used as placeholders.
function isValidCpfChecksum(cpf: string): boolean {
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false
  const calcDigit = (slice: string, start: number) => {
    let sum = 0
    for (let i = 0; i < slice.length; i++) {
      sum += parseInt(slice[i], 10) * (start - i)
    }
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  const d1 = calcDigit(cpf.substring(0, 9),  10)
  const d2 = calcDigit(cpf.substring(0, 10), 11)
  return d1 === parseInt(cpf[9], 10) && d2 === parseInt(cpf[10], 10)
}

export const loginSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
  // Optional — required only for users with twoFactorEnabled = true.
  // The login flow returns { requires2FA: true } when code is missing.
  code:     z.string().regex(/^\d{6}$/).optional(),
})

export const twoFactorCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
})

// Change password (authenticated user). currentPassword verified via
// bcrypt.compare server-side. newPassword min 6 to match register (we
// keep both bounds in sync so the same UX rules apply on signup and
// here).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(6).max(72),
})

// KYC: 3 base64 data URLs (data:image/...;base64,XXX). Server stores them
// as-is in kyc_submissions URL columns. ~2-3MB combined when 3 phone photos.
const dataUrlSchema = z.string()
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/, 'Apenas imagens JPEG/PNG/WEBP.')
  .max(4_500_000, 'Imagem muito grande (máx ~3MB cada).')

export const kycSubmitSchema = z.object({
  documentFrontUrl: dataUrlSchema,
  documentBackUrl:  dataUrlSchema,
  selfieUrl:        dataUrlSchema,
})

export const updateProfileSchema = z.object({
  name:      z.string().min(2).max(80).trim().optional(),
  email:     z.string().email().toLowerCase().trim().optional(),
  nickname:  z.string().max(60).trim().optional(),
  lastName:  z.string().max(80).trim().optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  cpf:       z.string().max(20).trim().optional(),
  phone:     z.string().max(30).trim().optional(),
  country:   z.string().max(60).trim().optional(),
  address:   z.string().max(200).trim().optional(),
  city:      z.string().max(80).trim().optional(),
  state:     z.string().max(80).trim().optional(),
  zip:       z.string().max(20).trim().optional(),
})

export type RegisterInput       = z.infer<typeof registerSchema>
export type LoginInput          = z.infer<typeof loginSchema>
export type UpdateProfileInput  = z.infer<typeof updateProfileSchema>
export type TwoFactorCodeInput  = z.infer<typeof twoFactorCodeSchema>
export type KycSubmitInput      = z.infer<typeof kycSubmitSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
