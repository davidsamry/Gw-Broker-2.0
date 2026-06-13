import type { FastifyInstance } from 'fastify'
import { getSettings } from '../settings/service.js'
import {
  listTraders,
  listMyTraders,
  copyTrader,
  cancelCopy,
} from './service.js'

// Rotas de Copy Trading (usuário). Todas exigem auth. Respeitam o toggle
// global copyTradeEnabled das PlatformSettings.
export async function copyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate)

  // Lista os traders disponíveis (+ flag `copied` pro user logado).
  app.get('/traders', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      const traders = await listTraders(userId)
      return reply.send({ traders, enabled: getSettings().copyTradeEnabled })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // "Meus Traders" — assinaturas ativas + resumo.
  app.get('/my', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      const traders = await listMyTraders(userId)
      return reply.send({ traders })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Copiar/assinar um trader.
  app.post('/:traderId/copy', async (req, reply) => {
    if (!getSettings().copyTradeEnabled) {
      return reply.status(403).send({ error: 'COPY_DISABLED' })
    }
    const userId     = ((req as any).user.sub) as string
    const { traderId } = req.params as { traderId: string }
    try {
      const result = await copyTrader(userId, traderId)
      return reply.status(201).send({ result })
    } catch (err: any) {
      const code = err?.message
      // Erros de negócio mapeados pro front mostrar o modal certo.
      if (code === 'TRADER_NOT_FOUND')       return reply.status(404).send({ error: 'TRADER_NOT_FOUND' })
      if (code === 'ALREADY_COPYING')        return reply.status(409).send({ error: 'ALREADY_COPYING' })
      if (code === 'REAL_ACCOUNT_NOT_FOUND') return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      if (code === 'NO_BALANCE')             return reply.status(400).send({ error: 'NO_BALANCE' })
      if (code === 'INSUFFICIENT_BALANCE')   return reply.status(400).send({ error: 'INSUFFICIENT_BALANCE' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Cancelar a cópia.
  app.post('/:traderId/cancel', async (req, reply) => {
    const userId     = ((req as any).user.sub) as string
    const { traderId } = req.params as { traderId: string }
    try {
      await cancelCopy(userId, traderId)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err?.message === 'NOT_COPYING') return reply.status(409).send({ error: 'NOT_COPYING' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
