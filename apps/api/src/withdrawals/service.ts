import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import type { CreateWithdrawalInput } from './schema.js'

export interface WithdrawalRow {
  id:          string
  accountId:   string
  amount:      string
  method:      string
  destination: string
  status:      string
  notes:       string | null
  createdAt:   Date
  updatedAt:   Date
  processedAt: Date | null
}

// Atomic create — single CTE: validate ownership + balance, debit balance,
// insert withdrawal, insert ledger transaction. Mirrors createOperation.
export async function createWithdrawal(userId: string, input: CreateWithdrawalInput) {
  const withdrawalId  = randomUUID()
  const transactionId = randomUUID()
  const amountDec     = new Prisma.Decimal(input.amount)
  const negAmount     = new Prisma.Decimal(-input.amount)
  const description   = `Solicitação de retirada: ${input.method}`

  const rows = await prisma.$queryRaw<WithdrawalRow[]>`
    WITH
      valid AS (
        SELECT id FROM accounts
        WHERE id = ${input.accountId}
          AND "userId" = ${userId}
          AND balance >= ${amountDec}
      ),
      ins_wd AS (
        INSERT INTO withdrawals
          (id, "accountId", amount, method, destination, status, "createdAt", "updatedAt")
        SELECT
          ${withdrawalId}, id, ${amountDec},
          ${input.method}::"WithdrawalMethod",
          ${input.destination},
          'PENDING'::"WithdrawalStatus", NOW(), NOW()
        FROM valid
        RETURNING *
      ),
      upd_bal AS (
        UPDATE accounts
        SET balance = balance - ${amountDec}
        WHERE id IN (SELECT id FROM valid)
        RETURNING id
      ),
      ins_tx AS (
        INSERT INTO transactions
          (id, "accountId", type, amount, description, "createdAt")
        SELECT ${transactionId}, id, 'WITHDRAWAL'::"TransactionType",
               ${negAmount}, ${description}, NOW()
        FROM valid
        RETURNING id
      )
    SELECT * FROM ins_wd
  `

  if (rows.length === 0) {
    const account = await prisma.account.findUnique({ where: { id: input.accountId } })
    if (!account || account.userId !== userId) throw new Error('ACCOUNT_NOT_FOUND')
    throw new Error('INSUFFICIENT_BALANCE')
  }

  return rows[0]
}

// All withdrawals for the user (across all accounts), newest first.
export async function listWithdrawals(userId: string): Promise<WithdrawalRow[]> {
  return prisma.$queryRaw<WithdrawalRow[]>`
    SELECT w.*
    FROM withdrawals w
    INNER JOIN accounts a ON a.id = w."accountId"
    WHERE a."userId" = ${userId}
    ORDER BY w."createdAt" DESC
    LIMIT 50
  `
}

// User cancels their own pending withdrawal — refund balance, mark CANCELLED.
// Only PENDING withdrawals can be cancelled by the user.
export async function cancelWithdrawal(userId: string, withdrawalId: string) {
  const refundId = randomUUID()
  const description = 'Retirada cancelada pelo usuário'

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      valid AS (
        SELECT w.id, w."accountId", w.amount
        FROM withdrawals w
        INNER JOIN accounts a ON a.id = w."accountId"
        WHERE w.id = ${withdrawalId}
          AND a."userId" = ${userId}
          AND w.status = 'PENDING'::"WithdrawalStatus"
      ),
      upd_wd AS (
        UPDATE withdrawals
        SET status = 'CANCELLED'::"WithdrawalStatus",
            "processedAt" = NOW(),
            "updatedAt"   = NOW()
        WHERE id IN (SELECT id FROM valid)
        RETURNING id
      ),
      upd_bal AS (
        UPDATE accounts
        SET balance = balance + (SELECT amount FROM valid)
        WHERE id = (SELECT "accountId" FROM valid)
        RETURNING id
      ),
      ins_tx AS (
        INSERT INTO transactions
          (id, "accountId", type, amount, description, "createdAt")
        SELECT ${refundId}, "accountId", 'WITHDRAWAL'::"TransactionType",
               amount, ${description}, NOW()
        FROM valid
        RETURNING id
      )
    SELECT id FROM upd_wd
  `

  if (rows.length === 0) {
    throw new Error('WITHDRAWAL_NOT_CANCELLABLE')
  }
}
