import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSettings, updateSettings } from '../../settings/service.js'

// All routes here sit behind requireAdmin (attached at /admin root).

const updateSchema = z.object({
  withdrawalFeePct:       z.number().min(0).max(100).optional(),
  withdrawalMin:          z.number().min(0).max(1_000_000).optional(),
  withdrawalMax:          z.number().min(0).max(10_000_000).optional(),
  depositMin:             z.number().min(0).max(1_000_000).optional(),
  depositMax:             z.number().min(0).max(10_000_000).optional(),
  depositRollover:        z.number().min(0).max(100).optional(),
  operationMin:           z.number().min(0).max(1_000_000).optional(),
  operationMax:           z.number().min(0).max(10_000_000).optional(),
  operationMinIntervalMs: z.number().int().min(0).max(60_000).optional(),
  copyTradeEnabled:       z.boolean().optional(),
}).refine(
  (v) => Object.values(v).some((x) => x !== undefined),
  { message: 'Envie pelo menos um campo.' },
)
  .refine(
    (v) => v.withdrawalMin === undefined || v.withdrawalMax === undefined || v.withdrawalMin <= v.withdrawalMax,
    { message: 'withdrawalMin não pode ser maior que withdrawalMax.' },
  )
  .refine(
    (v) => v.depositMin === undefined || v.depositMax === undefined || v.depositMin <= v.depositMax,
    { message: 'depositMin não pode ser maior que depositMax.' },
  )
  .refine(
    (v) => v.operationMin === undefined || v.operationMax === undefined || v.operationMin <= v.operationMax,
    { message: 'operationMin não pode ser maior que operationMax.' },
  )

export async function settingsAdminRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send({ settings: getSettings() })
  })

  app.patch('/', async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const settings = await updateSettings(parsed.data)
      return reply.send({ settings })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
