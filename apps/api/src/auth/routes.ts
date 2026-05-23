import type { FastifyInstance, FastifyReply } from 'fastify'
import { loginSchema, registerSchema } from './schema.js'
import { getUserById, loginUser, registerUser } from './service.js'

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
      const user = await getUserById(userId)
      return reply.send({ user })
    } catch {
      return reply.status(404).send({ error: 'USER_NOT_FOUND' })
    }
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
