import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { approveWithdrawal, listAdminWithdrawals, rejectWithdrawal } from './service.js'

const listQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
  search:   z.string().trim().min(1).optional(),
  status:   z.enum(['ALL', 'PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED', 'FAILED']).optional(),
})

const rejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

export async function withdrawalsAdminRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const data = await listAdminWithdrawals(parsed.data)
      return reply.send(data)
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/:id/approve', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      await approveWithdrawal(adminId, id)
      return reply.send({ ok: true, status: 'COMPLETED' })
    } catch (err: any) {
      if (err.message === 'WITHDRAWAL_NOT_PENDING') return reply.status(409).send({ error: 'WITHDRAWAL_NOT_PENDING' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/:id/reject', async (req, reply) => {
    const parsed = rejectSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      await rejectWithdrawal(adminId, id, parsed.data.reason)
      return reply.send({ ok: true, status: 'CANCELLED' })
    } catch (err: any) {
      if (err.message === 'WITHDRAWAL_NOT_PENDING') return reply.status(409).send({ error: 'WITHDRAWAL_NOT_PENDING' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
