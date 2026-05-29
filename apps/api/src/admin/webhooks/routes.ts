import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  listWebhookConfigs, updateWebhookConfig, type WebhookKey,
} from '../../webhooks/service.js'

const WEBHOOK_KEYS = ['REGISTRATION', 'FIRST_DEPOSIT', 'SUBSEQUENT_DEPOSIT'] as const

// PATCH body — both fields optional so the UI can toggle active without
// retyping the URL, or update URL without changing active. URL accepts
// http/https; the sender rejects empty strings at fire time.
const patchBody = z.object({
  url:    z.string().trim().max(2048).optional(),
  active: z.boolean().optional(),
}).refine((v) => v.url !== undefined || v.active !== undefined, {
  message: 'Provide at least one of: url, active.',
})

const paramsSchema = z.object({
  key: z.enum(WEBHOOK_KEYS),
})

export async function webhooksAdminRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    const configs = await listWebhookConfigs()
    return reply.send({ configs })
  })

  app.patch('/:key', async (req, reply) => {
    const p = paramsSchema.safeParse(req.params)
    if (!p.success) return reply.status(400).send({ error: 'INVALID_KEY' })
    const b = patchBody.safeParse(req.body)
    if (!b.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: b.error.flatten() })
    }
    // Light URL sanity check — if the admin is editing the URL field, it
    // must look like an http(s) URL (or be empty, meaning "clear it").
    // The sender also short-circuits on empty url, so this is just UX:
    // catching typos at save time instead of at fire time.
    if (b.data.url !== undefined && b.data.url.trim() !== '' && !/^https?:\/\//i.test(b.data.url.trim())) {
      return reply.status(400).send({
        error:   'INVALID_URL',
        message: 'URL deve começar com http:// ou https://',
      })
    }
    const updated = await updateWebhookConfig(p.data.key as WebhookKey, b.data)
    if (!updated) return reply.status(404).send({ error: 'NOT_FOUND' })
    return reply.send({ config: updated })
  })
}
