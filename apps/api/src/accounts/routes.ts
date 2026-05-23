import type { FastifyInstance } from 'fastify'
import { listAccounts, resetDemoAccount } from './service.js'

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate)

  app.get('/', async (req, reply) => {
    const userId   = ((req as any).user.sub) as string
    const accounts = await listAccounts(userId)
    return reply.send({ accounts })
  })

  app.post('/demo/reset', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      const result = await resetDemoAccount(userId)
      return reply.send(result)
    } catch (err: any) {
      if (err.message === 'DEMO_ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({ error: 'DEMO_ACCOUNT_NOT_FOUND' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
