import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getAdminEmailTemplate,
  listAdminEmailTemplates,
  previewEmailTemplate,
  sendTestEmail,
  updateAdminEmailTemplate,
} from './service.js'
import { prisma } from '../../prisma.js'

// All routes here sit behind the requireAdmin preHandler attached at
// /admin/* root, so no per-route gate needed.

const updateSchema = z.object({
  subject:  z.string().min(1).max(998).optional(),    // RFC 5322 line limit
  htmlBody: z.string().min(1).max(200_000).optional(), // ~200KB ceiling
  active:   z.boolean().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'Envie pelo menos um campo.',
})

export async function emailAdminRoutes(app: FastifyInstance) {

  app.get('/templates', async (_req, reply) => {
    try {
      const templates = await listAdminEmailTemplates()
      return reply.send({ templates })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/templates/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    try {
      const template = await getAdminEmailTemplate(key)
      if (!template) return reply.status(404).send({ error: 'TEMPLATE_NOT_FOUND' })
      return reply.send({ template })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.patch('/templates/:key', async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { key } = req.params as { key: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const template = await updateAdminEmailTemplate(adminId, key, parsed.data)
      if (!template) return reply.status(404).send({ error: 'TEMPLATE_NOT_FOUND' })
      return reply.send({ template })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── Send a test email to the admin themselves. Uses the admin's own
  // email from the JWT-attached user record so we don't trust client-
  // supplied recipients (would otherwise be a vector for spam relay).
  app.post('/templates/:key/test', async (req, reply) => {
    const { key } = req.params as { key: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const admin = await prisma.user.findUnique({
        where:  { id: adminId },
        select: { email: true },
      })
      if (!admin) return reply.status(404).send({ error: 'ADMIN_NOT_FOUND' })

      const result = await sendTestEmail(key, admin.email)
      if (!result.ok) return reply.status(500).send({ error: result.reason ?? 'SEND_FAILED' })
      return reply.send({ ok: true, sentTo: admin.email, messageId: result.messageId })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── Rendered preview (no send). Returns the subject + html with
  // sample-data placeholders — used by the panel's "Visualizar" modal.
  app.get('/templates/:key/preview', async (req, reply) => {
    const { key } = req.params as { key: string }
    try {
      const preview = await previewEmailTemplate(key)
      if (!preview) return reply.status(404).send({ error: 'TEMPLATE_NOT_FOUND' })
      return reply.send(preview)
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
