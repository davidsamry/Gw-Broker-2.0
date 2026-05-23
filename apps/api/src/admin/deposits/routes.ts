import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listAdminDeposits, markDepositPaid, toggleDepositFake } from './service.js'

const listQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
  search:   z.string().trim().min(1).optional(),
  status:   z.enum(['ALL', 'PENDING', 'PAID', 'FAILED', 'CANCELLED']).optional(),
})

const fakeBodySchema = z.object({
  isFake: z.boolean(),
})

export async function depositsAdminRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const data = await listAdminDeposits(parsed.data)
      return reply.send(data)
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/:id/mark-paid', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      await markDepositPaid(adminId, id)
      return reply.send({ ok: true, status: 'PAID' })
    } catch (err: any) {
      if (err.message === 'DEPOSIT_NOT_PAYABLE') return reply.status(409).send({ error: 'DEPOSIT_NOT_PAYABLE' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.patch('/:id/fake', async (req, reply) => {
    const parsed = fakeBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    }
    const { id } = req.params as { id: string }
    try {
      await toggleDepositFake(id, parsed.data.isFake)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err.message === 'DEPOSIT_NOT_FOUND') return reply.status(404).send({ error: 'DEPOSIT_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
