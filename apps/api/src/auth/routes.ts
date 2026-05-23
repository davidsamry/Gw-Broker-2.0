import type { FastifyInstance, FastifyReply } from 'fastify'
import { loginSchema, registerSchema, updateProfileSchema, twoFactorCodeSchema } from './schema.js'
import { getUserById, loginUser, registerUser, updateUserProfile } from './service.js'
import { listOperations } from '../operations/service.js'
import { listWithdrawals } from '../withdrawals/service.js'
import { listTransactions } from '../transactions/service.js'
import { generateSecret, otpauthUrl, qrCodeDataUrl, verifyTotp } from './twoFactor.js'
import { prisma } from '../prisma.js'

const REFRESH_COOKIE = 'refresh_token'
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    try {
      const user  = await registerUser(parsed.data)
      const token = await issueTokens(app, reply, user.id)
      return reply.send({ token, user })
    } catch (err: any) {
      if (err.message === 'EMAIL_TAKEN') {
        return reply.status(409).send({ error: 'EMAIL_TAKEN' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    try {
      const user  = await loginUser(parsed.data)
      const token = await issueTokens(app, reply, user.id)
      return reply.send({ token, user })
    } catch (err: any) {
      if (err.message === 'INVALID_CREDENTIALS') {
        return reply.status(401).send({ error: 'INVALID_CREDENTIALS' })
      }
      // 2FA: password OK but code missing — surface this so the frontend can
      // ask for it. Don't issue any token yet.
      if (err.message === 'REQUIRES_2FA') {
        return reply.status(401).send({ error: 'REQUIRES_2FA', requires2FA: true })
      }
      if (err.message === 'INVALID_2FA_CODE') {
        return reply.status(401).send({ error: 'INVALID_2FA_CODE', requires2FA: true })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/refresh', async (req, reply) => {
    try {
      const decoded = await (req as any).refreshJwtVerify()
      const userId  = decoded.sub as string
      const token   = await issueTokens(app, reply, userId)
      return reply.send({ token })
    } catch {
      return reply.status(401).send({ error: 'INVALID_REFRESH' })
    }
  })

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(REFRESH_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })

  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      // Fetch user + recent operations + withdrawals + transactions in
      // parallel — saves multiple RTTs on every page mount by letting the
      // client hydrate all the Conta tabs from one call.
      const [user, operations, withdrawals, transactions] = await Promise.all([
        getUserById(userId),
        listOperations(userId).catch(() => []),
        listWithdrawals(userId).catch(() => []),
        listTransactions(userId).catch(() => []),
      ])
      return reply.send({ user, operations, withdrawals, transactions })
    } catch {
      return reply.status(404).send({ error: 'USER_NOT_FOUND' })
    }
  })

  app.patch('/me', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const parsed = updateProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = ((req as any).user.sub) as string
    try {
      const user = await updateUserProfile(userId, parsed.data)
      return reply.send({ user })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── 2FA management ─────────────────────────────────────────────────────────
  // Setup: generates a new secret + QR. Stored as twoFactorSecret but flag
  // stays false until the user confirms a code via /2fa/enable.
  app.post('/2fa/setup', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (!user) return reply.status(404).send({ error: 'USER_NOT_FOUND' })

    const secret = generateSecret()
    await prisma.user.update({
      where: { id: userId },
      data:  { twoFactorSecret: secret, twoFactorEnabled: false },
    })

    const qrDataUrl = await qrCodeDataUrl(secret, user.email)
    return reply.send({
      secret,
      otpauthUrl: otpauthUrl(secret, user.email),
      qrDataUrl,
    })
  })

  // Enable: confirms the user actually scanned by requiring a valid code.
  app.post('/2fa/enable', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const parsed = twoFactorCodeSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'INVALID_CODE_FORMAT' })

    const userId = ((req as any).user.sub) as string
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    })
    if (!user || !user.twoFactorSecret) {
      return reply.status(400).send({ error: 'SETUP_NOT_STARTED' })
    }
    if (!verifyTotp(user.twoFactorSecret, parsed.data.code)) {
      return reply.status(401).send({ error: 'INVALID_2FA_CODE' })
    }
    await prisma.user.update({
      where: { id: userId },
      data:  { twoFactorEnabled: true },
    })
    return reply.send({ ok: true, enabled: true })
  })

  // Disable: requires a valid code so a stolen session can't kill 2FA.
  app.post('/2fa/disable', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const parsed = twoFactorCodeSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'INVALID_CODE_FORMAT' })

    const userId = ((req as any).user.sub) as string
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true, role: true },
    })
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return reply.status(400).send({ error: 'NOT_ENABLED' })
    }
    // Admins cannot disable 2FA (would defeat the mandatory policy).
    if (user.role === 'ADMIN') {
      return reply.status(403).send({ error: 'ADMIN_2FA_REQUIRED' })
    }
    if (!verifyTotp(user.twoFactorSecret, parsed.data.code)) {
      return reply.status(401).send({ error: 'INVALID_2FA_CODE' })
    }
    await prisma.user.update({
      where: { id: userId },
      data:  { twoFactorSecret: null, twoFactorEnabled: false },
    })
    return reply.send({ ok: true, enabled: false })
  })
}

async function issueTokens(app: FastifyInstance, reply: FastifyReply, userId: string) {
  const accessToken  = await app.jwt.sign({ sub: userId })
  const refreshToken = await (app.jwt as any).refresh.sign({ sub: userId })

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   REFRESH_MAX_AGE,
  })

  return accessToken
}
