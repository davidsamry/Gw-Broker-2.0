import type { FastifyInstance } from 'fastify'
import { getMyWeeklyRanking, getPublicRanking } from './service.js'

export async function rankingRoutes(app: FastifyInstance) {
  // Public — same 3h-window draw for all visitors.
  app.get('/', async (_req, reply) => {
    try {
      const data = await getPublicRanking()
      return reply.send(data)
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Auth-protected — calculates the logged-in user's weekly winnings AND
  // their hypothetical position relative to the current leaderboard slice.
  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      const data = await getMyWeeklyRanking(userId)
      return reply.send(data)
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
