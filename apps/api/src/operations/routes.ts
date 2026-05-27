import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createOperationSchema } from './schema.js'
import { createOperation, getOperation, listOperations } from './service.js'
import { subscribeToUserOperations } from './events.js'

const listQuerySchema = z.object({
  accountId: z.string().cuid().optional(),
})

const streamQuerySchema = z.object({
  // EventSource can't set custom headers, so the access token rides in
  // a query param. Acceptable risk: tokens expire in 15min and only
  // grant the same access an authenticated user already has.
  token: z.string().min(20),
})

export async function operationRoutes(app: FastifyInstance) {

  // ── SSE stream (no bearer-auth preHandler) ──────────────────────────────
  // Registered at the parent scope so the addHook below doesn't apply.
  // EventSource can't set the Authorization header, so the JWT rides in a
  // query string parameter and we validate it manually. Accepts both web
  // tokens (no `kind` claim) and Bot API tokens (kind: 'bot') since both
  // represent the same authenticated user.
  app.get('/stream', async (req, reply) => {
    const q = streamQuerySchema.safeParse(req.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    let userId: string
    try {
      const decoded = await app.jwt.verify(q.data.token) as { sub?: string }
      if (!decoded?.sub) return reply.status(401).send({ error: 'UNAUTHORIZED' })
      userId = decoded.sub
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }

    // CORS — SSE writes direct to reply.raw, bypassing the cors plugin's
    // onSend hook, so we mirror the headers manually (same pattern as
    // /otc/v2/stream).
    const origin = (req.headers.origin as string | undefined) ?? ''
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
      reply.raw.setHeader('Vary', 'Origin')
    }
    reply.raw.setHeader('Content-Type',      'text/event-stream')
    reply.raw.setHeader('Cache-Control',     'no-cache, no-transform')
    reply.raw.setHeader('Connection',        'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders?.()
    reply.raw.write(`: connected user=${userId}\n\n`)

    // Heartbeat every 25s — keeps the connection alive through proxy
    // idle timeouts (Cloudflare 100s, Traefik 60s default).
    const heartbeat = setInterval(() => {
      try { reply.raw.write(`: hb ${Date.now()}\n\n`) } catch { /* socket closing */ }
    }, 25_000)

    const unsubscribe = subscribeToUserOperations(userId, (event) => {
      try {
        reply.raw.write(`event: ${event.kind}\ndata: ${JSON.stringify(event.op)}\n\n`)
      } catch { /* client gone — disconnect handler cleans up */ }
    })

    // Cleanup on client disconnect — covers both clean close and
    // network drop (Node fires 'close' for both).
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  // ── Authenticated routes ────────────────────────────────────────────────
  // Wrapped in a child plugin so the addHook only applies in this scope,
  // leaving /stream above untouched. (Fastify hooks propagate parent →
  // children, so the previous approach of "register /stream first then
  // addHook on parent" did NOT isolate the stream — every route still
  // hit the bearer-auth.)
  await app.register(async (auth) => {
    auth.addHook('preHandler', (app as any).authenticate)

    auth.post('/', async (req, reply) => {
      const parsed = createOperationSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
      }

      const userId = ((req as any).user.sub) as string
      try {
        const operation = await createOperation(userId, parsed.data)
        return reply.status(201).send({ operation })
      } catch (err: any) {
        if (err.message === 'ACCOUNT_NOT_FOUND') {
          return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
        }
        if (err.message === 'INSUFFICIENT_BALANCE') {
          return reply.status(400).send({ error: 'INSUFFICIENT_BALANCE' })
        }
        if (err.message === 'TOO_FAST') {
          return reply.status(429).send({ error: 'TOO_FAST' })
        }
        req.log.error(err)
        return reply.status(500).send({ error: 'INTERNAL_ERROR' })
      }
    })

    auth.get('/', async (req, reply) => {
      const parsed = listQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
      }

      const userId = ((req as any).user.sub) as string
      try {
        const operations = await listOperations(userId, parsed.data.accountId)
        return reply.send({ operations })
      } catch (err: any) {
        if (err.message === 'ACCOUNT_NOT_FOUND') {
          return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
        }
        req.log.error(err)
        return reply.status(500).send({ error: 'INTERNAL_ERROR' })
      }
    })

    auth.get('/:id', async (req, reply) => {
      const userId = ((req as any).user.sub) as string
      const { id } = req.params as { id: string }
      try {
        const operation = await getOperation(userId, id)
        return reply.send({ operation })
      } catch (err: any) {
        if (err.message === 'NOT_FOUND') {
          return reply.status(404).send({ error: 'NOT_FOUND' })
        }
        req.log.error(err)
        return reply.status(500).send({ error: 'INTERNAL_ERROR' })
      }
    })
  })
}
