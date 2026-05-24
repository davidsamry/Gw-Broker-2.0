import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { bulkSetPayout, listAdminAssets, updateAsset } from './service.js'
import { reloadOtcAssets } from '../../otc/worker.js'

const listQuerySchema = z.object({
  category: z.enum(['ALL', 'OPEN_MARKET', 'OTC', 'CRYPTO']).optional(),
})

const updateSchema = z.object({
  name:           z.string().trim().min(1).max(120).optional(),
  payout:         z.number().int().min(1).max(100).optional(),
  enabled:        z.boolean().optional(),
  // OTC pricing controls. seedPrice accepts null to clear it (disables
  // OTC pricing for that asset — worker will skip it after reload).
  seedPrice:      z.union([z.number().positive(), z.null()]).optional(),
  volatility:     z.number().min(0).max(0.1).optional(),
  tickIntervalMs: z.number().int().min(100).max(60_000).optional(),
}).refine(
  (v) => (
    v.name !== undefined || v.payout !== undefined || v.enabled !== undefined ||
    v.seedPrice !== undefined || v.volatility !== undefined || v.tickIntervalMs !== undefined
  ),
  { message: 'Nenhum campo enviado.' },
)

const bulkPayoutSchema = z.object({
  payout:   z.number().int().min(1).max(100),
  category: z.enum(['OPEN_MARKET', 'OTC', 'CRYPTO']).optional(),
})

export async function assetsAdminRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const data = await listAdminAssets(parsed.data)
      return reply.send(data)
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.patch('/:id', async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id } = req.params as { id: string }
    try {
      const asset = await updateAsset(id, parsed.data)
      if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
      return reply.send({ asset })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/bulk-payout', async (req, reply) => {
    const parsed = bulkPayoutSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const updated = await bulkSetPayout(parsed.data.payout, parsed.data.category)
      return reply.send({ ok: true, updated })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Kicks the in-process OTC worker to re-read every OTC asset's seedPrice
  // and volatility from DB. Admin calls this after editing those fields so
  // the change takes effect on the next tick instead of needing a process
  // restart. No-op on assets without seedPrice or with marketSymbol set.
  app.post('/otc-reload', async (req, reply) => {
    try {
      const loaded = await reloadOtcAssets()
      return reply.send({ ok: true, loaded })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
