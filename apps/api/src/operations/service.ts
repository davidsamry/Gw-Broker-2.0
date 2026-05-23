import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import type { CreateOperationInput } from './schema.js'

export async function createOperation(userId: string, input: CreateOperationInput) {
  const operationId   = randomUUID()
  const transactionId = randomUUID()
  const expiresAt     = new Date(Date.now() + input.expiresInSeconds * 1000)
  const description   = `Operação aberta: ${input.assetSymbol} ${input.direction}`

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
          ${input.payout}, ${new Prisma.Decimal(input.entryPrice)},
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
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { id: true },
  })
  const accountIds = accounts.map((a: { id: string }) => a.id)

  if (accountId && !accountIds.includes(accountId)) throw new Error('ACCOUNT_NOT_FOUND')

  return prisma.operation.findMany({
    where: { accountId: accountId ? accountId : { in: accountIds } },
    orderBy: { openedAt: 'desc' },
    take: 50,
  })
}

export async function getOperation(userId: string, operationId: string) {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    include: { account: { select: { userId: true } } },
  })
  if (!op || op.account.userId !== userId) throw new Error('NOT_FOUND')
  return op
}
