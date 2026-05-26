import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getManipulationSettings, setManipulationEnabled,
  listManipulationSignals, createManipulationSignal,
  updateManipulationSignal, deleteManipulationSignal,
} from './service.js'

const directionEnum = z.enum(['CALL', 'PUT'])

const createBody = z.object({
  assetId:     z.string().min(1),
  scheduledAt: z.string().datetime(),   // ISO 8601 from frontend
  timeframe:   z.number().int().min(5).max(3600).default(60),
  direction:   directionEnum,
})

const updateBody = z.object({
  assetId:     z.string().min(1).optional(),
  scheduledAt: z.string().datetime().optional(),
  timeframe:   z.number().int().min(5).max(3600).optional(),
  direction:   directionEnum.optional(),
  enabled:     z.boolean().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'At least one field must be supplied.',
})

const settingsBody = z.object({
  enabled: z.boolean(),
})

export async function manipulationAdminRoutes(app: FastifyInstance) {
  // ── Master toggle ──
  app.get('/settings', async (_req, reply) => {
    const data = await getManipulationSettings()
    return reply.send(data)
  })

  app.patch('/settings', async (req, reply) => {
    const parsed = settingsBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const data = await setManipulationEnabled(parsed.data.enabled)
    return reply.send(data)
  })

  // ── Signals CRUD ──
  app.get('/signals', async (_req, reply) => {
    const data = await listManipulationSignals()
    return reply.send({ signals: data })
  })

  app.post('/signals', async (req, reply) => {
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const signal = await createManipulationSignal({
        ...parsed.data,
        scheduledAt: new Date(parsed.data.scheduledAt),
      })
      return reply.status(201).send({ signal })
    } catch (err: any) {
      req.log.error(err)
      // FK violation = unknown assetId
      if (err?.code === 'P2003' || /foreign key/i.test(err?.message ?? '')) {
        return reply.status(400).send({ error: 'ASSET_NOT_FOUND' })
      }
      return reply.status(500).send({ error: 'INTERNAL_ERROR', detail: err?.message })
    }
  })

  app.patch('/signals/:id', async (req, reply) => {
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id } = req.params as { id: string }
    const signal = await updateManipulationSignal(id, {
      ...parsed.data,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
    })
    if (!signal) return reply.status(404).send({ error: 'SIGNAL_NOT_FOUND' })
    return reply.send({ signal })
  })

  app.delete('/signals/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = await deleteManipulationSignal(id)
    if (!ok) return reply.status(404).send({ error: 'SIGNAL_NOT_FOUND' })
    return reply.send({ ok: true })
  })
}
