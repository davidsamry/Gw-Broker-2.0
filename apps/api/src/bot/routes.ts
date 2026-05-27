// Bot API — REST endpoints for external bots and automations.
//
// Mount: /bot/v1/*
//
// Design principles:
//   - Reuse the existing services (createOperation, listOperations,
//     getOperation) so business rules (atomic balance debit, rollover,
//     min-interval throttle, settings-driven min/max) stay in one place.
//   - Wrap responses in the snake_case shapes the documented spec
//     defines via mappers.ts.
//   - Bot tokens carry `kind: 'bot'` so they can't be reused on web
//     endpoints (and vice versa).
//   - 2FA is bypassed at the bot login — per founder decision; a leaked
//     password is the only attack surface, mitigated by rate limit +
//     ability to revoke all refresh tokens server-side.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { listBinanceAssets } from '../market/service.js'
import { createOperation, listOperations, getOperation } from '../operations/service.js'
import { getSettings } from '../settings/service.js'
import { checkRateLimit, recordFailure, resetLimit } from './rateLimit.js'
import { issueTokenPair, rotateRefreshToken } from './tokens.js'
import { botAuthenticate, type BotAuthUser } from './middleware.js'
import { mapAsset, mapBalance, mapProfile, mapTrade, type OperationIn } from './mappers.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Get the requesting IP. Honors x-forwarded-for if Fastify is behind a
 *  reverse proxy (EasyPanel/Traefik); falls back to socket address. */
function clientIp(req: FastifyRequest): string | null {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
  return fwd || req.ip || null
}

/** Compact "EURUSD" / "BTCUSDT" → catalog entry. We search by both the
 *  raw `marketSymbol` (already compact) and a normalised version of the
 *  display symbol so bots can use either format. */
async function findAssetBySymbol(symbol: string) {
  const compact = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  // Reuse listBinanceAssets — it already handles admin enable/disable +
  // payout overrides. Fast enough (single REST fetch + one DB query),
  // and bots wouldn't hammer /trade fast enough to need a cache here.
  const assets = await listBinanceAssets()
  for (const a of assets) {
    const ms = (a.marketSymbol ?? '').toUpperCase()
    const sb = (a.symbol ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
    if (ms === compact || sb === compact) return a
  }
  return null
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const loginBody = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(1).max(72),
})

const refreshBody = z.object({
  refresh_token: z.string().min(20),
})

const tradeBody = z.object({
  symbol:           z.string().min(2).max(20),
  direction:        z.enum(['up', 'down']),
  stake:            z.number().positive().multipleOf(0.01),
  duration_seconds: z.union([z.literal(60), z.literal(300), z.literal(900)]),
})

const tradesQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('all'),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// ── Routes ──────────────────────────────────────────────────────────────────

export async function botRoutes(app: FastifyInstance) {

  // ── POST /login ─────────────────────────────────────────────────────────
  app.post('/login', async (req, reply) => {
    const ip       = clientIp(req)
    const limitKey = `bot:login:${ip ?? 'unknown'}`

    // Pre-check rate limit BEFORE running bcrypt so an attacker can't
    // slow the server with throwaway passwords.
    const limit = checkRateLimit(limitKey)
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterS))
      return reply.status(429).send({
        error:        'RATE_LIMIT_EXCEEDED',
        retry_after:  limit.retryAfterS,
      })
    }

    const parsed = loginBody.safeParse(req.body)
    if (!parsed.success) {
      recordFailure(limitKey)
      return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    }

    const user = await prisma.user.findUnique({
      where:  { email: parsed.data.email },
      select: { id: true, email: true, password: true, blocked: true },
    })
    if (!user) {
      recordFailure(limitKey)
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS' })
    }

    const ok = await bcrypt.compare(parsed.data.password, user.password)
    if (!ok) {
      recordFailure(limitKey)
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS' })
    }

    if (user.blocked) {
      return reply.status(403).send({ error: 'ACCOUNT_BLOCKED' })
    }

    // Per founder decision: bots skip 2FA. Web login still enforces it
    // via the existing /auth/login path — this only relaxes the bot
    // surface, not the user-facing one.

    resetLimit(limitKey)
    const pair = await issueTokenPair(app, user.id, ip)

    return reply.send({
      success:       true,
      access_token:  pair.access_token,
      refresh_token: pair.refresh_token,
      expires_in:    pair.expires_in,
      user:          { id: user.id, email: user.email },
    })
  })

  // ── POST /refresh ───────────────────────────────────────────────────────
  app.post('/refresh', async (req, reply) => {
    const parsed = refreshBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    try {
      const { pair } = await rotateRefreshToken(app, parsed.data.refresh_token, clientIp(req))
      return reply.send({
        success:       true,
        access_token:  pair.access_token,
        refresh_token: pair.refresh_token,
        expires_in:    pair.expires_in,
      })
    } catch {
      return reply.status(401).send({ error: 'REFRESH_INVALID' })
    }
  })

  // ── Authenticated zone ──────────────────────────────────────────────────
  // Everything below requires a bot access token.

  // GET /profile — full user shape per spec
  app.get('/profile', { preHandler: [botAuthenticate] }, async (req, reply) => {
    const u = req.botUser as BotAuthUser
    const full = await prisma.user.findUnique({
      where:  { id: u.id },
      include: { accounts: true },
    })
    if (!full) return reply.status(404).send({ error: 'USER_NOT_FOUND' })
    return reply.send(mapProfile({
      user:     full,
      accounts: full.accounts as any,
    }))
  })

  // GET /balance — REAL-account balance + rollover state
  app.get('/balance', { preHandler: [botAuthenticate] }, async (req, reply) => {
    const u = req.botUser as BotAuthUser
    const accounts = await prisma.account.findMany({
      where: { userId: u.id },
    })
    const real = accounts.find((a) => a.type === 'REAL') as any
    return reply.send(mapBalance(real))
  })

  // GET /assets — Binance catalog (admin disable/payout overrides applied)
  app.get('/assets', { preHandler: [botAuthenticate] }, async (_req, reply) => {
    const assets = await listBinanceAssets()
    return reply.send({ assets: assets.map(mapAsset) })
  })

  // POST /trade — open an operation against the REAL account
  app.post('/trade', { preHandler: [botAuthenticate] }, async (req, reply) => {
    const u = req.botUser as BotAuthUser
    const parsed = tradeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    // Settings-driven min/max (admin /admin/configuracoes). The schema
    // inside operations/service.ts re-checks these too — duplicating
    // here so we can return a friendlier error code/message faster.
    const s = getSettings()
    if (parsed.data.stake < s.operationMin || parsed.data.stake > s.operationMax) {
      return reply.status(400).send({
        error:   'STAKE_OUT_OF_RANGE',
        min:     s.operationMin,
        max:     s.operationMax,
      })
    }

    const asset = await findAssetBySymbol(parsed.data.symbol)
    if (!asset) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })

    // Bot trades always hit the REAL account. Demo trades would just be
    // free practice — bots don't need that.
    const account = await prisma.account.findFirst({
      where:  { userId: u.id, type: 'REAL' },
      select: { id: true },
    })
    if (!account) return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })

    // Fetch live entry price. For Binance assets we use the ticker the
    // chart uses; createOperation will overwrite OTC entries from
    // otc_ticks anyway, so any positive value works as a placeholder
    // there.
    const entryPrice = asset.price || 1

    try {
      const op = await createOperation(u.id, {
        accountId:        account.id,
        assetId:          asset.id,
        assetSymbol:      asset.label || asset.symbol,
        marketSymbol:     asset.source === 'BINANCE' ? asset.marketSymbol : undefined,
        direction:        parsed.data.direction === 'up' ? 'CALL' : 'PUT',
        amount:           parsed.data.stake,
        payout:           asset.payout,
        entryPrice,
        expiresInSeconds: parsed.data.duration_seconds,
      })

      // Re-read balance for accurate `new_balance` (createOperation
      // returns the operation row, not the post-debit balance).
      const updatedAccount = await prisma.account.findUnique({
        where:  { id: account.id },
        select: { balance: true },
      })
      const newBalance = parseFloat(updatedAccount?.balance.toString() ?? '0')

      const trade = mapTrade(op as unknown as OperationIn)
      return reply.status(201).send({
        success: true,
        trade: {
          id:                trade.id,
          symbol:            trade.symbol,
          direction:         trade.direction,
          stake:             trade.stake,
          entry_price:       trade.entry_price,
          payout_percentage: trade.payout_percentage,
          expires_at:        trade.expires_at,
          created_at:        trade.created_at,
        },
        new_balance: newBalance,
      })
    } catch (err: any) {
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({ error: 'INSUFFICIENT_BALANCE' })
      }
      if (err.message === 'TOO_FAST') {
        return reply.status(429).send({ error: 'TOO_FAST' })
      }
      if (err.message === 'ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /trades — paginated history. status filter: open / closed / all.
  app.get('/trades', { preHandler: [botAuthenticate] }, async (req, reply) => {
    const u = req.botUser as BotAuthUser
    const parsed = tradesQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    // Reuse listOperations (returns the most recent 50 across all
    // accounts). For pagination/filtering by status we layer it on top
    // — small enough dataset (max 50 from the service) that we don't
    // need a custom query.
    const all = await listOperations(u.id)
    let filtered = all as unknown as OperationIn[]
    if (parsed.data.status === 'open')   filtered = filtered.filter((o) => o.status === 'OPEN')
    if (parsed.data.status === 'closed') filtered = filtered.filter((o) => o.status !== 'OPEN')

    const sliced = filtered.slice(parsed.data.offset, parsed.data.offset + parsed.data.limit)
    return reply.send({
      trades: sliced.map(mapTrade),
      count:  sliced.length,
      limit:  parsed.data.limit,
      offset: parsed.data.offset,
    })
  })

  // GET /trade/:id — single operation by id, scoped to the caller.
  app.get('/trade/:id', { preHandler: [botAuthenticate] }, async (req, reply) => {
    const u = req.botUser as BotAuthUser
    const { id } = req.params as { id: string }
    try {
      const op = await getOperation(u.id, id)
      return reply.send(mapTrade(op as unknown as OperationIn))
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') return reply.status(404).send({ error: 'NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
