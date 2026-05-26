import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  adjustUserBalance, getUserDetail, listUsers, updateUserByAdmin,
  updateUserBonus, resetUserPassword,
} from './service.js'

const listQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
  search:   z.string().trim().min(1).optional(),
  role:     z.enum(['USER', 'ADMIN', 'ALL']).optional(),
  kyc:      z.enum(['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ALL']).optional(),
  blocked:  z.enum(['YES', 'NO', 'ALL']).optional(),
})

// PATCH body — every field optional. Caller sends only what changed.
// At least one field must be present (refine below) so we don't run an
// empty UPDATE.
const updateBodySchema = z.object({
  // Existing admin actions
  role:          z.enum(['USER', 'ADMIN']).optional(),
  blocked:       z.boolean().optional(),
  blockedReason: z.string().max(500).optional().nullable(),
  // Profile fields
  name:          z.string().trim().min(1).max(120).optional(),
  lastName:      z.string().trim().max(120).optional().nullable(),
  email:         z.string().trim().email().max(200).optional(),
  cpf:           z.string().trim().max(20).optional().nullable(),
  phone:         z.string().trim().max(40).optional().nullable(),
  // Admin toggles
  isFake:                z.boolean().optional(),
  copyTraderEnabled:     z.boolean().optional(),
  // Per-user payout overrides
  payoutOverrideForex:   z.number().int().min(0).max(100).optional().nullable(),
  payoutOverrideOtc:     z.number().int().min(0).max(100).optional().nullable(),
  payoutOverrideCrypto:  z.number().int().min(0).max(100).optional().nullable(),
  // Per-user market permissions
  canTradeForex:         z.boolean().optional(),
  canTradeOtc:           z.boolean().optional(),
  canTradeCrypto:        z.boolean().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'At least one field must be supplied.',
})

const balanceBodySchema = z.object({
  accountType: z.enum(['REAL', 'DEMO']),
  amount:      z.number().refine((n) => n !== 0, { message: 'Amount must be non-zero.' }),
  reason:      z.string().trim().min(3).max(200),
})

// Bonus + rollover lump-sum edit. accountId must belong to the target user
// (enforced server-side via the UPDATE … WHERE userId match).
const bonusBodySchema = z.object({
  accountId:        z.string().min(1),
  bonusBalance:     z.number().min(0).optional(),
  rolloverRequired: z.number().min(0).optional(),
  rolloverProgress: z.number().min(0).optional(),
}).refine(
  (v) => v.bonusBalance !== undefined || v.rolloverRequired !== undefined || v.rolloverProgress !== undefined,
  { message: 'At least one bonus field must be supplied.' },
)

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6).max(200),
})

export async function userAdminRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const data = await listUsers(parsed.data)
      return reply.send(data)
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      const data = await getUserDetail(id)
      return reply.send(data)
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND') return reply.status(404).send({ error: 'USER_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.patch('/:id', async (req, reply) => {
    const parsed = updateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id }    = req.params as { id: string }
    const adminId   = ((req as any).user.sub) as string
    try {
      const data = await updateUserByAdmin(adminId, id, parsed.data)
      return reply.send(data)
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND')         return reply.status(404).send({ error: 'USER_NOT_FOUND' })
      if (err.message === 'SELF_LOCKOUT_PROTECTED') return reply.status(400).send({ error: 'SELF_LOCKOUT_PROTECTED' })
      if (err.message === 'EMAIL_ALREADY_IN_USE')   return reply.status(409).send({ error: 'EMAIL_ALREADY_IN_USE' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/:id/balance', async (req, reply) => {
    const parsed = balanceBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const data = await adjustUserBalance(adminId, id, parsed.data)
      return reply.send(data)
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND')    return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      if (err.message === 'INSUFFICIENT_BALANCE') return reply.status(400).send({ error: 'INSUFFICIENT_BALANCE' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Lump-sum bonus + rollover edit (admin-direct, separate from BonusGrant).
  app.post('/:id/bonus', async (req, reply) => {
    const parsed = bonusBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id } = req.params as { id: string }
    try {
      const data = await updateUserBonus(id, parsed.data)
      return reply.send(data)
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Admin-forced password reset. Admin communicates the new password to
  // the user out-of-band; the server doesn't email it.
  app.post('/:id/reset-password', async (req, reply) => {
    const parsed = resetPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id } = req.params as { id: string }
    try {
      const data = await resetUserPassword(id, parsed.data.newPassword)
      return reply.send(data)
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND')      return reply.status(404).send({ error: 'USER_NOT_FOUND' })
      if (err.message === 'PASSWORD_TOO_SHORT')  return reply.status(400).send({ error: 'PASSWORD_TOO_SHORT' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
