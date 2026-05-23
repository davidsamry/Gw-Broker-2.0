import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { authRoutes } from './auth/routes.js'
import { operationRoutes } from './operations/routes.js'
import { accountRoutes } from './accounts/routes.js'
import { marketRoutes } from './market/routes.js'

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

  // ── Auth decorator ─────────────────────────────────────────────────────────
  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
  })

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(authRoutes,      { prefix: '/auth' })
  await app.register(operationRoutes, { prefix: '/operations' })
  await app.register(accountRoutes,   { prefix: '/accounts' })
  await app.register(marketRoutes,    { prefix: '/market' })

  return app
}
