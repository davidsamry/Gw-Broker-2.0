import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createRankingEntry, deleteRankingEntry, listAdminRanking, updateRankingEntry,
} from './service.js'
import { recordAdminAction } from '../auditLog.js'

const createSchema = z.object({
  name:        z.string().trim().min(2).max(60),
  countryCode: z.string().trim().toLowerCase().length(2),     // ISO alpha-2
  amount:      z.number().min(0).max(99_999_999),
  active:      z.boolean().optional(),
})

const updateSchema = z.object({
  name:        z.string().trim().min(2).max(60).optional(),
  countryCode: z.string().trim().toLowerCase().length(2).optional(),
  amount:      z.number().min(0).max(99_999_999).optional(),
  active:      z.boolean().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'Envie pelo menos um campo.',
})

export async function rankingAdminRoutes(app: FastifyInstance) {

  app.get('/', async (_req, reply) => {
    try {
      const entries = await listAdminRanking()
      return reply.send({ entries })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const entry = await createRankingEntry(parsed.data)
      void recordAdminAction(req, {
        resourceType: 'RANKING_PRIZE',
        resourceId:   (entry as any)?.id ?? null,
        action:       'CREATE',
        before:       null,
        after:        parsed.data,
      })
      return reply.send({ entry })
    } catch (err) {
      app.log.error(err)
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
      const entry = await updateRankingEntry(id, parsed.data)
      if (!entry) return reply.status(404).send({ error: 'ENTRY_NOT_FOUND' })
      void recordAdminAction(req, {
        resourceType: 'RANKING_PRIZE',
        resourceId:   id,
        action:       'UPDATE',
        before:       null,
        after:        parsed.data,
      })
      return reply.send({ entry })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      const ok = await deleteRankingEntry(id)
      if (!ok) return reply.status(404).send({ error: 'ENTRY_NOT_FOUND' })
      void recordAdminAction(req, {
        resourceType: 'RANKING_PRIZE',
        resourceId:   id,
        action:       'DELETE',
        before:       null,
        after:        null,
      })
      return reply.send({ ok: true })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
