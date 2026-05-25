import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { validateCodeForUser } from './service.js'

// User-facing bonus routes. /validate is the only public endpoint at B1 —
// listing user grants is exposed via /auth/me hydration in B2.

const validateSchema = z.object({
  code:          z.string().trim().min(2).max(32),
  depositAmount: z.number().positive().max(1_000_000),
})

export async function bonusRoutes(app: FastifyInstance) {
  // Requires auth — we need to know which user is checking.
  app.post('/validate', { preHandler: (app as any).authenticate }, async (req, reply) => {
    const parsed = validateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = (req as any).user.sub as string
    const result = await validateCodeForUser(userId, parsed.data.code, parsed.data.depositAmount)
    if (!result.ok) {
      return reply.status(400).send({ error: result.error })
    }
    return reply.send({ bonus: result.bonus })
  })
}
