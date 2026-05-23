import { z } from 'zod'

export const registerSchema = z.object({
  name:     z.string().min(2).max(80).trim(),
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(6).max(72),
})

export const loginSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
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
