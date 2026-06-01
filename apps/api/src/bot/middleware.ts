// Bot API authentication middleware.
//
// Verifies the JWT, asserts the `kind: 'bot'` claim (so web tokens can't
// be used here), loads the user (only the fields the bot endpoints need),
// and rejects blocked accounts with 403.
//
// Attached as `app.decorate('botAuthenticate', …)` in the route module
// so it can be passed in any route's `preHandler` array.

import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../prisma.js'

export interface BotAuthUser {
  id:             string
  email:          string
  name:           string
  blocked:        boolean
  kycStatus:      string
  canTradeOtc:    boolean
  canTradeCrypto: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    botUser?: BotAuthUser
  }
}

export async function botAuthenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await (req as any).jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'UNAUTHORIZED' })
  }

  const payload = (req as any).user as { sub?: string; kind?: string } | undefined
  if (!payload?.sub || payload.kind !== 'bot') {
    // Web access tokens omit `kind` — refuse them so a leaked web token
    // can't be repurposed against the Bot API's looser endpoints.
    return reply.status(401).send({ error: 'UNAUTHORIZED' })
  }

  const user = await prisma.user.findUnique({
    where:  { id: payload.sub },
    select: {
      id: true, email: true, name: true, blocked: true, kycStatus: true,
      canTradeOtc: true, canTradeCrypto: true,
    },
  })
  if (!user) {
    return reply.status(401).send({ error: 'UNAUTHORIZED' })
  }
  if (user.blocked) {
    return reply.status(403).send({ error: 'ACCOUNT_BLOCKED' })
  }

  req.botUser = user
}
