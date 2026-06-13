import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSettings, updateSettings } from '../../settings/service.js'
import { recordAdminAction } from '../auditLog.js'

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
  safeModeEnabled:        z.boolean().optional(),
  // % de lucro sobre a banca (saldo do último depósito confirmado) que
  // dispara auto-ativação de Liquidez + bloqueio de Cripto. 0 desativa
  // a função; 100 pra exigir 2× o saldo inicial; cap conservador 1000%.
  autoLiquidityProfitPct: z.number().int().min(0).max(1000).optional(),
  // % do rollover atingido que também dispara auto-Liquidez (OR com o lucro).
  // 0 desativa; cap 100 (não faz sentido exigir > 100% do rollover).
  autoLiquidityRolloverPct: z.number().int().min(0).max(100).optional(),
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
      const before = getSettings()
      const settings = await updateSettings(parsed.data)
      void recordAdminAction(req, {
        resourceType: 'SETTINGS',
        resourceId:   null,                  // singleton — sem ID
        action:       'UPDATE',
        before,
        after:        settings,
      })
      return reply.send({ settings })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
