import type { FastifyInstance } from 'fastify'
import { createWithdrawalSchema } from './schema.js'
import { cancelWithdrawal, createWithdrawal, listWithdrawals } from './service.js'

export async function withdrawalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate)

  app.get('/', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      const withdrawals = await listWithdrawals(userId)
      return reply.send({ withdrawals })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/', async (req, reply) => {
    const parsed = createWithdrawalSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const userId = ((req as any).user.sub) as string
    try {
      const withdrawal = await createWithdrawal(userId, parsed.data)
      return reply.status(201).send({ withdrawal })
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      }
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({ error: 'INSUFFICIENT_BALANCE' })
      }
      if (err.name === 'RolloverIncompleteError') {
        return reply.status(400).send({
          error:     'ROLLOVER_INCOMPLETE',
          required:  err.required,
          progress:  err.progress,
          remaining: err.remaining,
        })
      }
      if (err.name === 'KycNotApprovedError') {
        // 403 — semantic "forbidden until you verify". Frontend pops the
        // "verifique sua conta" modal and offers a direct link to KYC.
        return reply.status(403).send({
          error:     'KYC_NOT_APPROVED',
          kycStatus: err.kycStatus,
        })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/:id/cancel', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    const { id } = req.params as { id: string }
    try {
      await cancelWithdrawal(userId, id)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err.message === 'WITHDRAWAL_NOT_CANCELLABLE') {
        return reply.status(409).send({ error: 'WITHDRAWAL_NOT_CANCELLABLE' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
