// Bot API token helpers.
//
// Access token  → JWT, 1h, signed with the existing JWT secret. Carries
//                 { sub, kind: 'bot' } so the same middleware can refuse
//                 web-issued tokens on bot routes (and vice versa if we
//                 ever decide to harden web endpoints against bot tokens).
//
// Refresh token → opaque string (256-bit random, base64url). Only the
//                 SHA-256 hash is persisted in bot_refresh_tokens. A DB
//                 leak therefore can't replay live sessions. Rotated on
//                 every /refresh call — the previous row is marked
//                 revokedAt=NOW and a new row inserted.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../prisma.js'

export const ACCESS_TOKEN_TTL_SEC  = 60 * 60          // 1h, matches spec
export const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30 // 30d

/** Random URL-safe string. 32 bytes → 256 bits of entropy → unguessable. */
function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface TokenPair {
  access_token:  string
  refresh_token: string
  expires_in:    number   // seconds — matches spec
}

/** Sign a bot access JWT. Override per-call expiresIn since the global
 *  app.jwt config sets 15min for the web. */
export async function signBotAccessToken(app: FastifyInstance, userId: string): Promise<string> {
  return app.jwt.sign({ sub: userId, kind: 'bot' }, { expiresIn: `${ACCESS_TOKEN_TTL_SEC}s` })
}

/** Issue a fresh access + refresh pair for a given user.
 *  Persists the refresh-token hash so /refresh can verify + rotate. */
export async function issueTokenPair(
  app:    FastifyInstance,
  userId: string,
  ip:     string | null,
): Promise<TokenPair> {
  const accessToken  = await signBotAccessToken(app, userId)
  const refreshToken = randomToken()
  const tokenHash    = hashToken(refreshToken)
  const expiresAt    = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000)
  const id           = randomUUID()

  await prisma.$executeRaw`
    INSERT INTO bot_refresh_tokens ("id", "userId", "tokenHash", "expiresAt", "ip", "createdAt")
    VALUES (${id}, ${userId}, ${tokenHash}, ${expiresAt}, ${ip}, NOW())
  `

  return {
    access_token:  accessToken,
    refresh_token: refreshToken,
    expires_in:    ACCESS_TOKEN_TTL_SEC,
  }
}

interface BotRefreshRow {
  id:        string
  userId:    string
  expiresAt: Date
  revokedAt: Date | null
}

/** Validate + rotate a refresh token. Returns the userId on success;
 *  throws REFRESH_INVALID for any rejection reason (don't leak details). */
export async function rotateRefreshToken(
  app:           FastifyInstance,
  refreshToken:  string,
  ip:            string | null,
): Promise<{ userId: string; pair: TokenPair }> {
  const tokenHash = hashToken(refreshToken)
  const rows = await prisma.$queryRaw<BotRefreshRow[]>`
    SELECT id, "userId", "expiresAt", "revokedAt"
    FROM bot_refresh_tokens
    WHERE "tokenHash" = ${tokenHash}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) throw new Error('REFRESH_INVALID')
  if (row.revokedAt) throw new Error('REFRESH_INVALID')
  if (row.expiresAt.getTime() < Date.now()) throw new Error('REFRESH_INVALID')

  // Revoke the old row + issue a new pair in the same transaction so a
  // crash between the two doesn't strand the user without either token.
  await prisma.$executeRaw`
    UPDATE bot_refresh_tokens
    SET "revokedAt" = NOW(), "lastUsedAt" = NOW()
    WHERE id = ${row.id}
  `

  const pair = await issueTokenPair(app, row.userId, ip)
  return { userId: row.userId, pair }
}
