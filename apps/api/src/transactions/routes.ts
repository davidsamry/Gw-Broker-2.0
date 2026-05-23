import type { FastifyInstance } from 'fastify'
import { listTransactions } from './service.js'

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate)

  app.get('/', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      const transactions = await listTransactions(userId)
      return reply.send({ transactions })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
