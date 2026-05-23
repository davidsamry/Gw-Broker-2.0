import { prisma } from '../prisma.js'

export interface TransactionRow {
  id:          string
  accountId:   string
  type:        string
  amount:      string
  description: string | null
  createdAt:   Date
}

// All transactions for the user (across all accounts), newest first.
// Uses raw SQL to avoid relying on the Prisma client regen after schema
// changes (matches the pattern used elsewhere in the codebase).
export async function listTransactions(userId: string): Promise<TransactionRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    id:          string
    accountId:   string
    type:        string
    amount:      any
    description: string | null
    createdAt:   Date
  }>>`
    SELECT t.id, t."accountId", t.type::text, t.amount, t.description, t."createdAt"
    FROM transactions t
    INNER JOIN accounts a ON a.id = t."accountId"
    WHERE a."userId" = ${userId}
    ORDER BY t."createdAt" DESC
    LIMIT 100
  `
  // Cast Decimal → string for JSON safety.
  return rows.map((r) => ({ ...r, amount: r.amount.toString() }))
}
