import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from './auth/routes.js'
import { operationRoutes } from './operations/routes.js'
import { accountRoutes } from './accounts/routes.js'
import { marketRoutes } from './market/routes.js'
import { withdrawalRoutes } from './withdrawals/routes.js'
import { transactionRoutes } from './transactions/routes.js'
import { adminRoutes } from './admin/routes.js'
import { depositRoutes } from './deposits/routes.js'
import { bspayWebhookRoutes } from './webhooks/bspay.js'
import { ticketRoutes } from './tickets/routes.js'
import { otcV2Routes } from './otc/v2/routes.js'
import { prisma } from './prisma.js'

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' } })

  // ── Plugins ───────────────────────────────────────────────────────────────
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    ...(process.env.FRONTEND_URL ?? '').split(',').map(o => o.trim()).filter(Boolean),
  ]
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true)
      cb(new Error('Not allowed by CORS'), false)
    },
    credentials: true,
    // Cache the CORS preflight (OPTIONS) for 1h. Without this the browser
    // sends a separate OPTIONS request before every non-simple request
    // (POST with JSON body, etc.), doubling latency on each trade.
    maxAge: 3600,
  })

  await app.register(cookie)

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    sign: { expiresIn: '15m' },
  })

  await app.register(jwt, {
    secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    namespace: 'refresh',
    sign: { expiresIn: '7d' },
    cookie: { cookieName: 'refresh_token', signed: false },
  })

  // ── Auth decorators ───────────────────────────────────────────────────────
  // authenticate: verifies the JWT and exposes payload at req.user.
  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
  })

  // requireAdmin: authenticate + then load the user from DB and check that
  // role === ADMIN. We query the DB instead of stuffing the role into the
  // JWT so admin grants/revocations take effect immediately without waiting
  // for the access token to expire (15min).
  app.decorate('requireAdmin', async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
    const userId = req.user?.sub as string | undefined
    if (!userId) return reply.status(401).send({ error: 'UNAUTHORIZED' })
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { role: true },
    })
    if (!user || user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN' })
    }
  })

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(authRoutes,         { prefix: '/auth' })
  await app.register(operationRoutes,    { prefix: '/operations' })
  await app.register(accountRoutes,      { prefix: '/accounts' })
  await app.register(marketRoutes,       { prefix: '/market' })
  await app.register(withdrawalRoutes,   { prefix: '/withdrawals' })
  await app.register(transactionRoutes,  { prefix: '/transactions' })
  await app.register(adminRoutes,        { prefix: '/admin' })
  await app.register(depositRoutes,      { prefix: '/deposits' })
  await app.register(bspayWebhookRoutes, { prefix: '/webhooks' })
  await app.register(ticketRoutes,       { prefix: '/tickets'  })
  await app.register(otcV2Routes,        { prefix: '/otc/v2'   })

  return app
}
