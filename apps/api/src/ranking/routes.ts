import type { FastifyInstance } from 'fastify'
import { getPublicRanking } from './service.js'

// Public — no auth required. Frontend RankingPanel polls this every
// few minutes (or rerenders on focus). Cached implicitly by the deterministic
// shuffle: same 3h window = same response.
export async function rankingRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    try {
      const data = await getPublicRanking()
      return reply.send(data)
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
