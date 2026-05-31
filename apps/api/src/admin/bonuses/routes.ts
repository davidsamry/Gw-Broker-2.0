import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createBonus, deleteBonus, listAdminBonuses, updateBonus,
} from './service.js'
import { recordAdminAction } from '../auditLog.js'

// All routes here sit behind requireAdmin (added at /admin/* root).

const createSchema = z.object({
  code:           z.string().trim().min(2).max(32).regex(/^[A-Z0-9_-]+$/i, 'Apenas letras, números, _ e -.'),
  type:           z.enum(['PERCENTAGE', 'FIXED']),
  // For PERCENTAGE: typically 1..500 (= 1%..500%). For FIXED: any positive R$.
  value:          z.number().positive().max(100_000),
  minDeposit:     z.number().min(0).max(1_000_000),
  rollover:       z.number().int().min(1).max(100),
  active:         z.boolean().optional(),
  maxUsesPerUser: z.number().int().min(1).max(100).optional(),
  // ISO date string OR null (= no expiry).
  expiresAt:      z.string().datetime().nullable().optional(),
})

const updateSchema = createSchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
  { message: 'Nenhum campo enviado.' },
)

export async function bonusesAdminRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    try {
      const bonuses = await listAdminBonuses()
      return reply.send({ bonuses })
    } catch (err: any) {
      // Verbose log so EasyPanel logs surface the actual cause (table missing,
      // enum mismatch, pool exhausted, etc.) without needing a separate debug.
      app.log.error({ err: err?.message, stack: err?.stack, code: err?.code }, '[admin/bonuses] list failed')
      return reply.status(500).send({
        error:  'INTERNAL_ERROR',
        // Include the underlying message in non-prod so the admin UI shows
        // something actionable. In prod we keep it generic to avoid leaking
        // schema details.
        detail: process.env.NODE_ENV !== 'production' ? (err?.message ?? null) : null,
      })
    }
  })

  app.post('/', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const bonus = await createBonus({
        ...parsed.data,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      })
      void recordAdminAction(req, {
        resourceType: 'BONUS_CODE',
        resourceId:   (bonus as any)?.id ?? null,
        action:       'CREATE',
        before:       null,
        after:        parsed.data,
      })
      return reply.status(201).send({ bonus })
    } catch (err: any) {
      // Unique-violation on code.
      if (err?.code === 'P2002') {
        return reply.status(409).send({ error: 'CODE_TAKEN' })
      }
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
      const bonus = await updateBonus(id, {
        ...parsed.data,
        expiresAt: parsed.data.expiresAt !== undefined
          ? (parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null)
          : undefined,
      })
      void recordAdminAction(req, {
        resourceType: 'BONUS_CODE',
        resourceId:   id,
        action:       'UPDATE',
        before:       null,
        after:        parsed.data,
      })
      return reply.send({ bonus })
    } catch (err: any) {
      if (err?.code === 'P2025') return reply.status(404).send({ error: 'NOT_FOUND' })
      if (err?.code === 'P2002') return reply.status(409).send({ error: 'CODE_TAKEN' })
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      await deleteBonus(id)
      void recordAdminAction(req, {
        resourceType: 'BONUS_CODE',
        resourceId:   id,
        action:       'DELETE',
        before:       null,
        after:        null,
      })
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err?.code === 'P2025') return reply.status(404).send({ error: 'NOT_FOUND' })
      // Foreign key — existing grants tied to this bonus.
      if (err?.code === 'P2003') {
        return reply.status(409).send({ error: 'HAS_GRANTS', message: 'Bônus possui resgates — desative em vez de excluir.' })
      }
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
