import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDashboard } from './service.js'

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to:   z.string().datetime().optional(),
})

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    // Defaults: last 30 days ending now.
    const to   = parsed.data.to   ? new Date(parsed.data.to)   : new Date()
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)

    try {
      const data = await getDashboard(from, to)
      return reply.send(data)
    } catch (err: any) {
      req.log.error(err)
      // Surface details so the admin UI can show "column X does not
      // exist" when migrations are stale instead of generic "Erro".
      // Safe — endpoint is admin-only.
      return reply.status(500).send({
        error:   'INTERNAL_ERROR',
        detail:  err?.message ?? String(err),
        pgCode:  err?.code,
      })
    }
  })
}
