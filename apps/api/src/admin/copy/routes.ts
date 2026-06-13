import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listAdminTraders, updateTrader, listAdminSubscriptions } from './service.js'
import { recordAdminAction } from '../auditLog.js'

const updateSchema = z.object({
  name:          z.string().trim().min(1).max(60).optional(),
  countryCode:   z.string().trim().toLowerCase().length(2).optional(),
  avatarUrl:     z.string().trim().max(500).nullable().optional(),
  vip:           z.boolean().optional(),
  paid:          z.boolean().optional(),
  accessPrice:   z.number().min(0).max(1_000_000).optional(),
  weeklyGainPct: z.number().min(-100).max(1000).optional(),
  copiers:       z.number().int().min(0).max(1_000_000).optional(),
  copiedTrades:  z.number().int().min(0).max(100_000_000).optional(),
  commissionPct: z.number().int().min(0).max(100).optional(),
  profitPct:     z.number().int().min(0).max(100).optional(),
  lossPct:       z.number().int().min(0).max(100).optional(),
  active:        z.boolean().optional(),
  displayOrder:  z.number().int().min(0).max(1000).optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'Envie pelo menos um campo.',
})

export async function copyAdminRoutes(app: FastifyInstance) {
  // Lista os traders (todos, inclusive inativos) pro admin gerenciar.
  app.get('/', async (_req, reply) => {
    try {
      const traders = await listAdminTraders()
      return reply.send({ traders })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Assinaturas + compras (controle): quem copiou, pago/grátis, status, resultado.
  app.get('/subscriptions', async (_req, reply) => {
    try {
      const data = await listAdminSubscriptions()
      return reply.send(data)
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Edita um trader.
  app.patch('/:id', async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id } = req.params as { id: string }
    try {
      const trader = await updateTrader(id, parsed.data)
      if (!trader) return reply.status(404).send({ error: 'TRADER_NOT_FOUND' })
      void recordAdminAction(req, {
        resourceType: 'COPY_TRADER',
        resourceId:   id,
        action:       'UPDATE',
        before:       null,
        after:        parsed.data,
      })
      return reply.send({ trader })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
