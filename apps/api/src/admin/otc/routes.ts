import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getAdminOtcAsset,
  getStreamStats,
  listAdminOtcAssets,
  listAdminOtcLogs,
  pauseAdminOtcAsset,
  resetAdminOtcAsset,
  resumeAdminOtcAsset,
  setAdminOtcAssetTrendBias,
  updateAdminOtcAsset,
} from './service.js'

// /admin/otc/* — Admin controls for the OTC v2 engine. Sits behind the
// requireAdmin preHandler attached at /admin/* root, so no per-route
// gate needed here.

const updateSchema = z.object({
  payout:          z.number().int().min(1).max(100).optional(),
  // Tick size as fraction of seedPrice. 0.0005 ≈ 5bp per tick — a
  // reasonable upper limit before the chart starts looking erratic.
  volatilityBase:  z.number().min(0.00005).max(0.01).optional(),
  // 1.0 = base 10Hz. Capped at 5x to avoid hammering the DB. Note:
  // takes full effect on next process restart (interval period is
  // captured at boot).
  speedMultiplier: z.number().min(0.1).max(5).optional(),
  enabled:         z.boolean().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'Nenhum campo enviado.',
})

const biasSchema = z.object({
  bias: z.number().min(-1).max(1),
})

const logsQuerySchema = z.object({
  assetId: z.string().trim().min(1).optional(),
  limit:   z.coerce.number().int().min(1).max(200).optional(),
})

export async function otcAdminRoutes(app: FastifyInstance) {
  app.get('/assets', async (_req, reply) => {
    try {
      const assets = await listAdminOtcAssets()
      return reply.send({ assets })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/assets/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      const asset = await getAdminOtcAsset(id)
      if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
      return reply.send({ asset })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.patch('/assets/:id', async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id }   = req.params as { id: string }
    const adminId  = ((req as any).user.sub) as string
    try {
      const asset = await updateAdminOtcAsset(adminId, id, parsed.data)
      if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
      return reply.send({ asset })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/assets/:id/pause', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const asset = await pauseAdminOtcAsset(adminId, id)
      if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
      return reply.send({ asset })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/assets/:id/resume', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const asset = await resumeAdminOtcAsset(adminId, id)
      if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
      return reply.send({ asset })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/assets/:id/reset', async (req, reply) => {
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const asset = await resetAdminOtcAsset(adminId, id)
      if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
      return reply.send({ asset })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/assets/:id/bias', async (req, reply) => {
    const parsed = biasSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const asset = await setAdminOtcAssetTrendBias(adminId, id, parsed.data.bias)
      if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
      return reply.send({ asset })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Fase 6 — live SSE stream stats. No body params; returns total +
  // per-asset counts + per-client details (id, age, ticksReceived,
  // candlesReceived, candlesSkipped). In-memory read, no DB hit.
  app.get('/stream-stats', async (_req, reply) => {
    try {
      const stats = getStreamStats()
      return reply.send(stats)
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/logs', async (req, reply) => {
    const parsed = logsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const logs = await listAdminOtcLogs(parsed.data.assetId, parsed.data.limit ?? 50)
      return reply.send({ logs })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
