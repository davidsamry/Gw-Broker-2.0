import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import type { CreateOperationInput } from './schema.js'
import { resolveOperationIfExpired } from './worker.js'
import { getSettings } from '../settings/service.js'

export async function createOperation(userId: string, input: CreateOperationInput) {
  // Min-interval guard — admin-configurable on /admin/configuracoes.
  // Prevents bot-style spam clicking and protects the engine from a
  // single user hammering operations at >10Hz.
  const minIntervalMs = getSettings().operationMinIntervalMs
  if (minIntervalMs > 0) {
    const last = await prisma.$queryRaw<Array<{ createdAt: Date }>>`
      SELECT o."createdAt"
      FROM operations o
      JOIN accounts   a ON a.id = o."accountId"
      WHERE a."userId" = ${userId}
        AND a.id      = ${input.accountId}
      ORDER BY o."createdAt" DESC
      LIMIT 1
    `
    const lastCreatedMs = last[0]?.createdAt.getTime() ?? 0
    if (lastCreatedMs > 0 && Date.now() - lastCreatedMs < minIntervalMs) {
      throw new Error('TOO_FAST')
    }
  }

  const operationId   = randomUUID()
  const transactionId = randomUUID()
  const expiresAt     = new Date(Date.now() + input.expiresInSeconds * 1000)
  const description   = `Operação aberta: ${input.assetSymbol} ${input.direction}`

  // ── Authoritative entryPrice for OTC ───────────────────────────────────
  // For OTC assets (marketSymbol null) the client-sent entryPrice can't
  // be trusted — they could send anything. Override with the latest
  // server-owned tick from otc_ticks. Client-sent stays as last resort
  // when the engine hasn't warmed up yet (e.g. brand-new asset).
  // BINANCE assets keep client-sent — chart is on the same live feed.
  let entryPrice = input.entryPrice
  if (!input.marketSymbol) {
    const ticks = await prisma.$queryRaw<Array<{ price: Prisma.Decimal }>>`
      SELECT price FROM otc_ticks
      WHERE "assetId" = ${input.assetId}
      ORDER BY "recordedAt" DESC
      LIMIT 1
    `
    if (ticks.length > 0) {
      entryPrice = Number(ticks[0].price)
    }
  }

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH
      valid AS (
        SELECT id FROM accounts
        WHERE id = ${input.accountId}
          AND "userId" = ${userId}
          AND balance >= ${new Prisma.Decimal(input.amount)}
      ),
      ins_op AS (
        INSERT INTO operations
          (id, "accountId", "assetId", "assetSymbol", "marketSymbol", direction, amount, payout, "entryPrice", "expiresAt", status, "openedAt")
        SELECT
          ${operationId}, id, ${input.assetId}, ${input.assetSymbol}, ${input.marketSymbol ?? null},
          ${input.direction}::"Direction", ${new Prisma.Decimal(input.amount)},
          ${input.payout}, ${new Prisma.Decimal(entryPrice)},
          ${expiresAt}, 'OPEN'::"OperationStatus", NOW()
        FROM valid
        RETURNING *
      ),
      upd_bal AS (
        UPDATE accounts
        SET balance = balance - ${new Prisma.Decimal(input.amount)}
        WHERE id IN (SELECT id FROM valid)
        RETURNING id
      ),
      ins_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${transactionId}, id, 'TRADE_LOSS'::"TransactionType", ${new Prisma.Decimal(-input.amount)}, ${description}, NOW()
        FROM valid
        RETURNING id
      )
    SELECT * FROM ins_op
  `

  if (rows.length === 0) {
    const account = await prisma.account.findUnique({ where: { id: input.accountId } })
    if (!account || account.userId !== userId) throw new Error('ACCOUNT_NOT_FOUND')
    throw new Error('INSUFFICIENT_BALANCE')
  }

  // Resolution is handled by the expiration worker (polls DB every second) —
  // no in-memory setTimeout, so operations survive API restarts.
  return rows[0]
}

export async function listOperations(userId: string, accountId?: string) {
  // Validate ownership when a specific accountId is requested.
  if (accountId) {
    const owned = await prisma.account.findFirst({
      where:  { id: accountId, userId },
      select: { id: true },
    })
    if (!owned) throw new Error('ACCOUNT_NOT_FOUND')
  }

  // Single query with relation filter (no separate account lookup needed
  // when accountId is omitted). Select only the fields the frontend renders
  // to keep the payload ~50% smaller than the previous full-row response.
  return prisma.operation.findMany({
    where: accountId
      ? { accountId }
      : { account: { userId } },
    orderBy: { openedAt: 'desc' },
    take: 50,
    select: {
      id:          true,
      accountId:   true,
      assetId:     true,
      assetSymbol: true,
      direction:   true,
      amount:      true,
      payout:      true,
      profit:      true,
      status:      true,
      entryPrice:  true,
      expiresAt:   true,
      openedAt:    true,
      closedAt:    true,
    },
  })
}

export async function getOperation(userId: string, operationId: string) {
  // JIT resolve so a read right after expiry doesn't have to wait for
  // the next worker tick (up to 1s). Safe to call always — it's a noop
  // when the op isn't OPEN or hasn't expired yet, and the atomic claim
  // inside prevents double-processing if the worker fires concurrently.
  await resolveOperationIfExpired(operationId)

  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    include: { account: { select: { userId: true } } },
  })
  if (!op || op.account.userId !== userId) throw new Error('NOT_FOUND')
  return op
}
