import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cancelAdminOperation, deleteAdminOperation, listAdminOperations } from './service.js'

const listQuerySchema = z.object({
  page:        z.coerce.number().int().min(1).optional(),
  pageSize:    z.coerce.number().int().min(5).max(100).optional(),
  search:      z.string().trim().min(1).optional(),
  status:      z.enum(['ALL', 'OPEN', 'WON', 'LOST', 'CANCELLED']).optional(),
  accountType: z.enum(['ALL', 'REAL', 'DEMO']).optional(),
})

export async function operationsAdminRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const data = await listAdminOperations(parsed.data)
      return reply.send(data)
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/:id/cancel', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      await cancelAdminOperation(adminId, id)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err.message === 'OPERATION_NOT_CANCELLABLE') {
        return reply.status(409).send({ error: 'OPERATION_NOT_CANCELLABLE' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Hard-delete an op + reverse balance impact. Response includes the
  // computed delta so the UI can confirm what happened.
  app.delete('/:id', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const result = await deleteAdminOperation(adminId, id)
      return reply.send({ ok: true, ...result })
    } catch (err: any) {
      if (err.message === 'OPERATION_NOT_FOUND') {
        return reply.status(404).send({ error: 'OPERATION_NOT_FOUND' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
