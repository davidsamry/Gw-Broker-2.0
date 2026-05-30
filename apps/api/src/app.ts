import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
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
import { bonusRoutes } from './bonuses/routes.js'
import { rankingRoutes } from './ranking/routes.js'
import { botRoutes } from './bot/routes.js'
import { publicRoutes } from './public/routes.js'
import { metricsRoute } from './metrics/route.js'
import { httpRequestDurationSeconds } from './metrics/registry.js'
import { prisma } from './prisma.js'

// ── Sec O1.1: JWT secrets — fail-fast em produção ─────────────────────────
// Antes esses tinham fallback `dev-secret-change-me` / `dev-refresh-secret-
// change-me` — strings PÚBLICAS no commit. Se a env var não estivesse
// setada em prod, qualquer um forjava access/refresh tokens com essas
// strings e logava como admin. Agora:
//   - PROD: throw imediato no boot (impede a app de subir sem secret)
//   - DEV : aceita default só com WARN explícito no console
function resolveSecret(envName: string, devFallback: string): string {
  const val = process.env[envName]
  if (val && val.length >= 16) return val
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[boot] ${envName} ausente ou < 16 chars — refuse to start in production. ` +
      `Configure a env var no EasyPanel (recomendado: 64+ chars random).`,
    )
  }
  // eslint-disable-next-line no-console
  console.warn(`[boot] ${envName} faltando — usando default INSEGURO de dev. NUNCA usar em prod.`)
  return devFallback
}

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' } })

  // ── Plugins ───────────────────────────────────────────────────────────────
  // Sec O1.2: CORS strict equality (URL origin completo, não prefix match).
  // Antes: origin.startsWith('http://localhost:3000') permitia
  // 'http://localhost:3000-evil.com' a passar (browser respeitando a
  // resposta CORS levaria credenciais pro domínio do atacante).
  // Agora: comparação exata. Lista construída do env + 2 defaults locais.
  const allowedOrigins = new Set<string>([
    'http://localhost:3000',
    'http://localhost:3001',
    ...(process.env.FRONTEND_URL ?? '').split(',').map(o => o.trim()).filter(Boolean),
  ])
  await app.register(cors, {
    origin: (origin, cb) => {
      // origin === undefined: same-origin / curl / mobile native — permitido
      if (!origin) return cb(null, true)
      if (allowedOrigins.has(origin)) return cb(null, true)
      cb(new Error('Not allowed by CORS'), false)
    },
    credentials: true,
    // Cache the CORS preflight (OPTIONS) for 1h. Without this the browser
    // sends a separate OPTIONS request before every non-simple request
    // (POST with JSON body, etc.), doubling latency on each trade.
    maxAge: 3600,
  })

  await app.register(cookie)

  // ── Sec O1.4: helmet (security headers) ───────────────────────────────────
  // Adiciona o pacote padrao de defesa: X-Frame-Options DENY (anti-
  // clickjacking), X-Content-Type-Options nosniff (anti-MIME-confusion),
  // Strict-Transport-Security max-age=180d (forca HTTPS no browser), e
  // outros (Referrer-Policy, X-DNS-Prefetch-Control, etc.). Custo
  // proximo de zero — sao apenas headers extras na resposta.
  //
  // CSP fica DESLIGADO por enquanto: o frontend Next.js carrega scripts
  // inline + estilos inline + fonts/imagens de varios CDNs (Resend,
  // Vercel, etc.), e ligar CSP sem auditar essas fontes quebra a UI.
  // Item separado pra Onda 3 (XSS bonus).
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })

  // ── Sec O1.5: rate-limit global registrado mas inativo (per-rota) ─────────
  // Aqui registramos o plugin como `global: false` — nenhuma rota e
  // afetada por padrao. Cada rota que quer rate-limit declara via
  // `{ config: { rateLimit: {...} } }` no proprio handler. O alvo
  // critico inicial e POST /auth/login (5 tentativas / 15 min, chaveado
  // por IP+email — atacante distribuido por multiplos IPs ainda fica
  // limitado por email; muitos emails do mesmo IP fica limitado por IP).
  await app.register(rateLimit, {
    global: false,
    // Storage default e in-memory por instancia. Se a API rodar em mais
    // de uma replica no EasyPanel, atacantes podem rebalancear pra
    // multiplicar tentativas pelo numero de replicas. Trocar pro Redis
    // quando subirmos replicas. Hoje (1 replica) o efeito e correto.
  })

  await app.register(jwt, {
    secret: resolveSecret('JWT_SECRET', 'dev-secret-change-me'),
    sign: { expiresIn: '15m' },
  })

  await app.register(jwt, {
    secret: resolveSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
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

  // ── Fase M3: HTTP metrics ─────────────────────────────────────────────────
  // Records duration for every request so Grafana can show p50/p95/p99
  // latency per route + status code. Routes that don't yet have a
  // routerPath (404s, errors before routing) fall back to "unknown" so
  // cardinality stays bounded. Excludes /metrics itself to avoid noise.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unknown'
    if (route === '/metrics') return
    const durationSec = reply.elapsedTime / 1000
    httpRequestDurationSeconds.observe(
      { method: req.method, route, status_code: String(reply.statusCode) },
      durationSec,
    )
  })
  await app.register(metricsRoute)

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
  await app.register(bonusRoutes,        { prefix: '/bonuses'  })
  await app.register(rankingRoutes,      { prefix: '/ranking'  })
  // Bot API — public REST surface for external bots & automations.
  // Auth is JWT with `kind: 'bot'` claim so web tokens can't be reused.
  await app.register(botRoutes,          { prefix: '/bot/v1'   })
  // Public — small read-only surface that pre-auth pages need (login,
  // register, reset). Currently exposes only the Modo Seguro toggle.
  await app.register(publicRoutes,       { prefix: '/public'   })

  return app
}
