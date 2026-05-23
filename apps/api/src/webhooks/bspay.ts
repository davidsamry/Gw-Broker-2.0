import type { FastifyInstance } from 'fastify'
import { confirmDepositById } from '../deposits/service.js'

// BSPay webhook handler. Authentication is via a shared secret embedded in
// the URL path (BSPAY_WEBHOOK_SECRET). The path itself acts as a bearer
// token — only the gateway knows the secret, so requests without it 404.
//
// The handler is intentionally permissive about payload shape: we look up
// the deposit by `external_id` (the id we generated when creating the
// cashin) and confirm it. confirmDepositById is idempotent — re-deliveries
// from the gateway are safe.

export async function bspayWebhookRoutes(app: FastifyInstance) {
  app.post('/bspay/:secret', async (req, reply) => {
    const { secret } = req.params as { secret: string }
    const expected   = process.env.BSPAY_WEBHOOK_SECRET
    if (!expected || secret !== expected) {
      // Mimic an unknown route so attackers can't probe for the endpoint.
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    const body = (req.body ?? {}) as any
    const event       = body.event ?? body.type ?? ''
    const externalId  = body.external_id ?? body.externalId ?? body.data?.external_id
    const status      = (body.status ?? body.data?.status ?? '').toLowerCase()

    req.log.info({ event, externalId, status }, 'BSPay webhook received')

    // Only act on cash-in confirmations. Ignore everything else (we don't
    // do crypto / cash-out via this app yet).
    const isConfirmed =
      event === 'cashin.confirmed' ||
      status === 'paid'            ||
      status === 'confirmed'

    if (!isConfirmed || !externalId) {
      return reply.send({ ok: true, acted: false })
    }

    try {
      const acted = await confirmDepositById(externalId)
      return reply.send({ ok: true, acted })
    } catch (err: any) {
      // Log + return 500 so BSPay retries (per docs, exponential backoff
      // for up to 5 attempts).
      req.log.error({ err, externalId }, 'Failed to confirm deposit')
      return reply.status(500).send({ ok: false })
    }
  })
}
