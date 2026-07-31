import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  listWebhookConfigs, updateWebhookConfig, getWebhookConfig, type WebhookKey,
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

  // POST /:key/test — dispatches a sample payload to the configured URL
  // and returns the live result (status code + duration) so the admin can
  // verify the receiver is reachable WITHOUT having to register a real
  // user or wait for a real deposit. Unlike the production flows this is
  // SYNCHRONOUS: we await the POST so the admin sees the outcome inline.
  //
  // The URL must already be saved (we read from the DB, not the request
  // body) so the admin can't accidentally test something different from
  // what'll fire in production. Test fires even if `active` is false —
  // toggle is a "production gate" only, not a "block all traffic" gate.
  app.post('/:key/test', async (req, reply) => {
    const p = paramsSchema.safeParse(req.params)
    if (!p.success) return reply.status(400).send({ error: 'INVALID_KEY' })

    const cfg = await getWebhookConfig(p.data.key as WebhookKey)
    if (!cfg)                                return reply.status(404).send({ error: 'NOT_FOUND' })
    if (!cfg.url || cfg.url.trim() === '')   return reply.status(400).send({ error: 'URL_EMPTY' })

    // Sample payload — MESMA forma que a produção envia (máximo de campos de
    // identidade pra advanced matching). Admin reconhece que veio do teste
    // pelo email/external_id obviamente falsos; produção usa os dados reais.
    // city/state/zip ficam de fora aqui porque a produção também não os
    // envia ainda (a plataforma não coleta esses campos).
    const sampleUser = {
      email:       'test@vx-global.com',
      phone:       '+5511999999999',
      first_name:  'Teste',
      last_name:   'VX Global',
      full_name:   'Teste VX Global',
      external_id: 'test-user-id-0001',
      country:     'Brasil',
    }
    const samplePayload =
      cfg.key === 'REGISTRATION'
        ? { event_name: 'Registration',  ...sampleUser }
        : cfg.key === 'FIRST_DEPOSIT'
          ? { event_name: 'FirstDeposit', value: 100.00, ...sampleUser }
          : { event_name: 'Deposit',      value: 250.00, ...sampleUser }

    const startedAt = Date.now()
    try {
      const res = await fetch(cfg.url.trim(), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(samplePayload),
        signal:  AbortSignal.timeout(30_000),
      })
      const durationMs = Date.now() - startedAt
      let responseBody: string | null = null
      try {
        responseBody = (await res.text()).slice(0, 500)   // cap to avoid huge dumps
      } catch { /* body unreadable — ignore */ }

      return reply.send({
        ok:           res.ok,
        status:       res.status,
        statusText:   res.statusText,
        durationMs,
        payloadSent:  samplePayload,
        responseBody,
      })
    } catch (err: any) {
      const durationMs = Date.now() - startedAt
      return reply.status(502).send({
        ok:          false,
        error:       err?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        message:     err?.message ?? String(err),
        durationMs,
        payloadSent: samplePayload,
      })
    }
  })
}
