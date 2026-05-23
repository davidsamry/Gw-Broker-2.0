import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { adjustUserBalance, getUserDetail, listUsers, updateUserByAdmin } from './service.js'

const listQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
  search:   z.string().trim().min(1).optional(),
  role:     z.enum(['USER', 'ADMIN', 'ALL']).optional(),
  kyc:      z.enum(['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ALL']).optional(),
  blocked:  z.enum(['YES', 'NO', 'ALL']).optional(),
})

const updateBodySchema = z.object({
  role:          z.enum(['USER', 'ADMIN']).optional(),
  blocked:       z.boolean().optional(),
  blockedReason: z.string().max(500).optional().nullable(),
}).refine((v) => v.role !== undefined || v.blocked !== undefined, {
  message: 'At least one field (role or blocked) must be supplied.',
})

const balanceBodySchema = z.object({
  accountType: z.enum(['REAL', 'DEMO']),
  amount:      z.number().refine((n) => n !== 0, { message: 'Amount must be non-zero.' }),
  reason:      z.string().trim().min(3).max(200),
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
}
