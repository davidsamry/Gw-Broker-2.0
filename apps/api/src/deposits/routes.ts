import type { FastifyInstance } from 'fastify'
import { createPixDepositSchema } from './schema.js'
import { createPixDeposit, getMyDepositStatus } from './service.js'

export async function depositRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate)

  app.post('/pix', async (req, reply) => {
    const parsed = createPixDepositSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = ((req as any).user.sub) as string
    try {
      const deposit = await createPixDeposit(userId, parsed.data)
      return reply.status(201).send({ deposit })
    } catch (err: any) {
      if (err.message === 'BSPAY_NOT_CONFIGURED') {
        return reply.status(503).send({ error: 'PAYMENT_GATEWAY_UNAVAILABLE' })
      }
      if (err.message === 'REAL_ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      }
      if (err.message?.startsWith('BSPAY_CASHIN_FAILED')) {
        req.log.error({ err }, 'BSPay cashin failed')
        return reply.status(502).send({ error: 'PAYMENT_GATEWAY_ERROR' })
      }
      // Fase B1: bonus validation errors raised by createPixDeposit when
      // a bonusCode was supplied. Surface them so the modal can map to
      // user-friendly messages.
      if (err.message?.startsWith('BONUS_')) {
        return reply.status(400).send({ error: err.message })
      }
      req.log.error({ err }, 'Unexpected deposit error')
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/:id', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const userId  = ((req as any).user.sub) as string
    try {
      const deposit = await getMyDepositStatus(userId, id)
      return reply.send({ deposit })
    } catch (err: any) {
      if (err.message === 'DEPOSIT_NOT_FOUND') return reply.status(404).send({ error: 'DEPOSIT_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
