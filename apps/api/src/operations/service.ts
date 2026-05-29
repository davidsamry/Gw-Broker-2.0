import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import type { CreateOperationInput } from './schema.js'
import { resolveOperationIfExpired } from './worker.js'
import { getSettings } from '../settings/service.js'
import { publishOperationEvent } from './events.js'
import { assertMarketAllowed } from './marketPermissions.js'

export async function createOperation(userId: string, input: CreateOperationInput) {
  // Per-user market permission gate. Admin toggles canTradeForex/Otc/Crypto
  // on /admin/usuarios — if the user's flag for THIS asset's market is
  // FALSE, refuse with MARKET_NOT_ALLOWED:<market>. Route handler maps
  // to 403 + the market name so the frontend shows the right message.
  // Runs BEFORE the throttle so an admin clarification is faster than a
  // rate-limit response.
  await assertMarketAllowed(userId, { id: input.assetId, marketSymbol: input.marketSymbol })

  // Min-interval guard — admin-configurable on /admin/configuracoes.
  // Prevents bot-style spam clicking and protects the engine from a
  // single user hammering operations at >10Hz.
  // NOTE: the operations table has no `createdAt` — `openedAt` is set
  // to NOW() on INSERT and serves the same purpose.
  const minIntervalMs = getSettings().operationMinIntervalMs
  if (minIntervalMs > 0) {
    const last = await prisma.$queryRaw<Array<{ openedAt: Date }>>`
      SELECT o."openedAt"
      FROM operations o
      JOIN accounts   a ON a.id = o."accountId"
      WHERE a."userId" = ${userId}
        AND a.id      = ${input.accountId}
      ORDER BY o."openedAt" DESC
      LIMIT 1
    `
    const lastOpenedMs = last[0]?.openedAt.getTime() ?? 0
    if (lastOpenedMs > 0 && Date.now() - lastOpenedMs < minIntervalMs) {
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
        -- Debit stake + accumulate rollover progress on REAL accounts.
        -- DEMO trades don't count toward the deposit rollover, otherwise
        -- a user could spam demo trades to unlock real-money withdrawals.
        UPDATE accounts
        SET balance          = balance - ${new Prisma.Decimal(input.amount)},
            "rolloverProgress" = CASE
              WHEN type = 'REAL'::"AccountType"
                THEN "rolloverProgress" + ${new Prisma.Decimal(input.amount)}
              ELSE "rolloverProgress"
            END
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

  // Broadcast 'created' to every connected session of this user — multi-
  // device sync + Bot API → web instant feedback. Best-effort; a publish
  // failure shouldn't fail the trade (the DB row is already committed).
  try {
    const row = rows[0] as Record<string, any>
    publishOperationEvent({
      kind:   'created',
      userId,
      op: {
        id:          String(row.id),
        accountId:   String(row.accountId),
        assetId:     String(row.assetId),
        assetSymbol: String(row.assetSymbol ?? ''),
        direction:   row.direction as 'CALL' | 'PUT',
        amount:      String(row.amount),
        payout:      Number(row.payout),
        profit:      row.profit == null ? null : String(row.profit),
        status:      'OPEN',
        entryPrice:  String(row.entryPrice),
        exitPrice:   row.exitPrice == null ? null : String(row.exitPrice),
        expiresAt:   (row.expiresAt as Date).toISOString(),
        openedAt:    (row.openedAt as Date).toISOString(),
        closedAt:    row.closedAt == null ? null : (row.closedAt as Date).toISOString(),
      },
    })
  } catch (err) {
    console.error('[operations] publish created event failed', err)
  }

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
