import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createPixDepositSchema } from './schema.js'
import { createPixDeposit, createUsdtDeposit, getMyDepositStatus } from './service.js'

const createUsdtSchema = z.object({
  amount: z.number().positive().multipleOf(0.01),
})

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
      if (err.message === 'BSPAY_NOT_CONFIGURED' || err.code === 'VERSELL_NOT_CONFIGURED') {
        return reply.status(503).send({ error: 'PAYMENT_GATEWAY_UNAVAILABLE' })
      }
      if (err.message === 'REAL_ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      }
      if (err.message?.startsWith('BSPAY_CASHIN_FAILED')) {
        req.log.error({ err }, 'BSPay cashin failed')
        return reply.status(502).send({ error: 'PAYMENT_GATEWAY_ERROR' })
      }
      // Erros da Versell (VersellError.code). Nunca logamos credenciais —
      // apenas code + detail já sanitizados pelo client.
      if (typeof err.code === 'string' && err.code.startsWith('VERSELL_')) {
        req.log.error(
          { code: err.code, httpStatus: err.httpStatus, detail: err.detail },
          '[VERSELL] PIX charge creation failed',
        )
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

  // ── USDT TRC20 deposit ────────────────────────────────────────────────
  // User digita amount em BRL — calculamos USDT via Binance USDTBRL spot,
  // pedimos endereco de wallet na BSPay (currency=USDT, chain=tron) e
  // retornamos. User envia o USDT, webhook confirma, saldo credita.
  app.post('/usdt', async (req, reply) => {
    const parsed = createUsdtSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = ((req as any).user.sub) as string
    try {
      const deposit = await createUsdtDeposit(userId, parsed.data.amount)
      return reply.status(201).send({ deposit })
    } catch (err: any) {
      if (err.message === 'BSPAY_NOT_CONFIGURED')      return reply.status(503).send({ error: 'PAYMENT_GATEWAY_UNAVAILABLE' })
      if (err.message === 'REAL_ACCOUNT_NOT_FOUND')    return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      if (err.message === 'BINANCE_RATE_FETCH_FAILED') return reply.status(503).send({ error: 'RATE_UNAVAILABLE' })
      if (err.message?.startsWith('BSPAY_CRYPTO_CASHIN_FAILED')) {
        req.log.error({ err }, 'BSPay crypto cashin failed')
        return reply.status(502).send({ error: 'PAYMENT_GATEWAY_ERROR' })
      }
      req.log.error({ err }, 'Unexpected USDT deposit error')
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
