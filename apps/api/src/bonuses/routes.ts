import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listAvailableBonusesForUser, validateCodeForUser } from './service.js'

// User-facing bonus routes.

const validateSchema = z.object({
  code:          z.string().trim().min(2).max(32),
  depositAmount: z.number().positive().max(1_000_000),
})

export async function bonusRoutes(app: FastifyInstance) {
  // All routes here need auth.
  app.addHook('preHandler', (app as any).authenticate)

  // List of bonus codes the current user can actually redeem. Powers the
  // dropdown in the deposit modal.
  app.get('/available', async (req, reply) => {
    try {
      const userId  = (req as any).user.sub as string
      const bonuses = await listAvailableBonusesForUser(userId)
      return reply.send({ bonuses })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/validate', async (req, reply) => {
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
