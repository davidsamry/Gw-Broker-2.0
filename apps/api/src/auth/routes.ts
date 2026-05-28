import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { loginSchema, registerSchema, updateProfileSchema, twoFactorCodeSchema, kycSubmitSchema, changePasswordSchema } from './schema.js'
import { changeUserPassword, getKycSubmission, getUserById, loginUser, registerUser, submitKyc, updateUserProfile } from './service.js'
import { requestPasswordReset, resetPasswordWithToken } from './passwordReset.js'
import { getSettings } from '../settings/service.js'
import { listOperations } from '../operations/service.js'
import { listWithdrawals } from '../withdrawals/service.js'
import { listTransactions } from '../transactions/service.js'
import { generateSecret, otpauthUrl, qrCodeDataUrl, verifyTotp } from './twoFactor.js'
import { prisma } from '../prisma.js'

const KYC_BODY_LIMIT = 10 * 1024 * 1024  // 10MB for the 3 base64 images

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
      if (err.message === 'CPF_TAKEN') {
        return reply.status(409).send({ error: 'CPF_TAKEN' })
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
      if (err.message === 'ACCOUNT_BLOCKED') {
        return reply.status(403).send({ error: 'ACCOUNT_BLOCKED' })
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

  // ── Password reset (forgot + confirm) ────────────────────────────────
  // ALWAYS 200 on /forgot-password to avoid the user-enumeration oracle.
  // /reset-password returns explicit error codes so the page can show
  // "link expirado" vs "link inválido" distinctly.
  const forgotSchema = z.object({
    email: z.string().email().toLowerCase().trim(),
  })
  app.post('/forgot-password', async (req, reply) => {
    const parsed = forgotSchema.safeParse(req.body)
    if (!parsed.success) {
      // Even invalid email shape returns 200 — same enumeration concern.
      return reply.send({ ok: true })
    }
    try {
      await requestPasswordReset(parsed.data.email)
    } catch (err) {
      req.log.error(err)
      // Still 200 — never leak that the request failed mid-flight.
    }
    return reply.send({ ok: true })
  })

  const resetSchema = z.object({
    token:    z.string().length(64).regex(/^[a-f0-9]+$/, 'token inválido'),
    password: z.string().min(8).max(72),
  })
  app.post('/reset-password', async (req, reply) => {
    const parsed = resetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      await resetPasswordWithToken(parsed.data.token, parsed.data.password)
      return reply.send({ ok: true })
    } catch (err: any) {
      const code = err.message
      if (code === 'TOKEN_INVALID' || code === 'TOKEN_USED' || code === 'TOKEN_EXPIRED' || code === 'PASSWORD_TOO_SHORT') {
        return reply.status(400).send({ error: code })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      // Fetch user + recent operations + withdrawals + transactions + KYC
      // submission in parallel — saves multiple RTTs on every page mount.
      const [user, operations, withdrawals, transactions, kycSubmission] = await Promise.all([
        getUserById(userId),
        listOperations(userId).catch(() => []),
        listWithdrawals(userId).catch(() => []),
        listTransactions(userId).catch(() => []),
        getKycSubmission(userId).catch(() => null),
      ])
      // Surface a small public-config payload so the frontend can
      // render valid min/max in the deposit/withdrawal/trading forms
      // (and hide the Copy menu when admin disabled it).
      const s = getSettings()
      const settings = {
        depositMin:             s.depositMin,
        depositMax:             s.depositMax,
        withdrawalMin:          s.withdrawalMin,
        withdrawalMax:          s.withdrawalMax,
        withdrawalFeePct:       s.withdrawalFeePct,
        operationMin:           s.operationMin,
        operationMax:           s.operationMax,
        operationMinIntervalMs: s.operationMinIntervalMs,
        copyTradeEnabled:       s.copyTradeEnabled,
      }
      return reply.send({ user, operations, withdrawals, transactions, kycSubmission, settings })
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
      if (err.message === 'EMAIL_TAKEN') {
        return reply.status(409).send({ error: 'EMAIL_TAKEN' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── Change password (authenticated) ─────────────────────────────────────
  // Distinct from /reset-password (which uses an email token + no auth).
  // Here the user is logged in and provides the current password as the
  // proof — no email needed. We do NOT rotate the session token after
  // success: the active access token stays valid until its 15min expiry.
  app.post('/change-password', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = ((req as any).user.sub) as string
    try {
      await changeUserPassword(userId, parsed.data)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err.message === 'USER_NOT_FOUND') {
        return reply.status(404).send({ error: 'USER_NOT_FOUND' })
      }
      if (err.message === 'INVALID_CURRENT_PASSWORD') {
        return reply.status(401).send({ error: 'INVALID_CURRENT_PASSWORD' })
      }
      if (err.message === 'SAME_PASSWORD') {
        return reply.status(400).send({ error: 'SAME_PASSWORD' })
      }
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

  // ── KYC submission (user-initiated) ──────────────────────────────────────
  // Bumped bodyLimit because the 3 base64-encoded images can total ~3-5MB.
  app.post('/kyc/submit', {
    bodyLimit: KYC_BODY_LIMIT,
    preHandler: [(app as any).authenticate],
  }, async (req, reply) => {
    const parsed = kycSubmitSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = ((req as any).user.sub) as string
    try {
      const submission = await submitKyc(userId, parsed.data)
      return reply.send({ ok: true, submission })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
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
