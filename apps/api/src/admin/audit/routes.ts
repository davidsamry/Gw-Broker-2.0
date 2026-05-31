import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listAuditLogs } from './service.js'

const listQuerySchema = z.object({
  page:         z.coerce.number().int().min(1).optional(),
  pageSize:     z.coerce.number().int().min(10).max(100).optional(),
  resourceType: z.string().trim().min(1).optional(),
  resourceId:   z.string().trim().min(1).optional(),
  adminId:      z.string().trim().min(1).optional(),
  action:       z.string().trim().min(1).optional(),
  dateFrom:     z.string().trim().min(1).optional(),
  dateTo:       z.string().trim().min(1).optional(),
})

export async function auditAdminRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const data = await listAuditLogs(parsed.data)
      return reply.send(data)
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
