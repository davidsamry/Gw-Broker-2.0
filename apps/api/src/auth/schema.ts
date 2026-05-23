import { z } from 'zod'

export const registerSchema = z.object({
  name:     z.string().min(2).max(80).trim(),
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(6).max(72),
})

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
  nickname:  z.string().max(60).trim().optional(),
  lastName:  z.string().max(80).trim().optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  cpf:       z.string().max(20).trim().optional(),
  phone:     z.string().max(30).trim().optional(),
  country:   z.string().max(60).trim().optional(),
  address:   z.string().max(200).trim().optional(),
})

export type RegisterInput      = z.infer<typeof registerSchema>
export type LoginInput         = z.infer<typeof loginSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>
export type KycSubmitInput     = z.infer<typeof kycSubmitSchema>
