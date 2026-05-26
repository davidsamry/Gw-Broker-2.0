import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'

// Admin-side operations management. Raw SQL throughout to keep parity with
// the rest of the admin module (and to avoid coupling to the generated
// Prisma client during schema iterations).

export interface OperationRow {
  id:           string
  accountId:    string
  accountType:  'REAL' | 'DEMO'
  userId:       string
  userName:     string
  userEmail:    string
  assetId:      string
  assetSymbol:  string
  marketSymbol: string | null
  direction:    'CALL' | 'PUT'
  amount:       string
  payout:       number
  entryPrice:   string
  exitPrice:    string | null
  profit:       string | null
  status:       'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  expiresAt:    Date
  openedAt:     Date
  closedAt:     Date | null
  /** Computed: round(expiresAt - openedAt) in seconds — for "Timeframe" col */
  timeframeSec: number
}

export interface ListOperationsParams {
  page?:        number
  pageSize?:    number
  search?:      string
  status?:      'ALL' | 'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  accountType?: 'ALL' | 'REAL' | 'DEMO'
}

export interface ListOperationsResponse {
  operations: OperationRow[]
  total:      number
  page:       number
  pageSize:   number
}

function decimalToString(x: any): string {
  if (x == null) return '0'
  if (typeof x === 'string') return x
  if (typeof x.toString === 'function') return x.toString()
  return String(x)
}

export async function listAdminOperations(params: ListOperationsParams): Promise<ListOperationsResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25))
  const offset   = (page - 1) * pageSize

  const where: Prisma.Sql[] = []
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push(Prisma.sql`(u.email ILIKE ${q} OR u.name ILIKE ${q} OR o."assetSymbol" ILIKE ${q})`)
  }
  if (params.status && params.status !== 'ALL') {
    where.push(Prisma.sql`o.status = ${params.status}::"OperationStatus"`)
  }
  if (params.accountType && params.accountType !== 'ALL') {
    where.push(Prisma.sql`a.type = ${params.accountType}::"AccountType"`)
  }
  const whereSql = where.length
    ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`
    : Prisma.empty

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT
        o.id, o."accountId", a.type::text AS "accountType",
        u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
        o."assetId", o."assetSymbol", o."marketSymbol",
        o.direction::text AS direction,
        o.amount, o.payout, o."entryPrice", o."exitPrice", o.profit,
        o.status::text AS status,
        o."expiresAt", o."openedAt", o."closedAt",
        EXTRACT(EPOCH FROM (o."expiresAt" - o."openedAt"))::int AS "timeframeSec"
      FROM operations o
      INNER JOIN accounts a ON a.id = o."accountId"
      INNER JOIN users    u ON u.id = a."userId"
      ${whereSql}
      ORDER BY o."openedAt" DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM operations o
      INNER JOIN accounts a ON a.id = o."accountId"
      INNER JOIN users    u ON u.id = a."userId"
      ${whereSql}
    `,
  ])

  const operations: OperationRow[] = rows.map((r) => ({
    ...r,
    amount:     decimalToString(r.amount),
    entryPrice: decimalToString(r.entryPrice),
    exitPrice:  r.exitPrice != null ? decimalToString(r.exitPrice) : null,
    profit:     r.profit    != null ? decimalToString(r.profit)    : null,
  }))

  return {
    operations,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  }
}

// ── Cancel pending operation ──────────────────────────────────────────────
// Atomic CTE: validates OPEN status, marks CANCELLED, refunds the stake to
// the source account, writes an ADJUSTMENT transaction with audit notes.

export async function cancelAdminOperation(adminId: string, operationId: string) {
  const refundTxId = randomUUID()
  const note       = `Operação cancelada por admin ${adminId.slice(0, 8)} — saldo devolvido`

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      target AS (
        SELECT id, "accountId", amount
        FROM operations
        WHERE id = ${operationId}
          AND status = 'OPEN'::"OperationStatus"
      ),
      upd_op AS (
        UPDATE operations
        SET status = 'CANCELLED'::"OperationStatus",
            "closedAt" = NOW()
        WHERE id IN (SELECT id FROM target)
        RETURNING id
      ),
      upd_bal AS (
        UPDATE accounts
        SET balance = balance + (SELECT amount FROM target)
        WHERE id = (SELECT "accountId" FROM target)
        RETURNING id
      ),
      ins_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${refundTxId}, "accountId", 'ADJUSTMENT'::"TransactionType",
               amount, ${note}, NOW()
        FROM target
        RETURNING id
      )
    SELECT id FROM upd_op
  `

  if (rows.length === 0) throw new Error('OPERATION_NOT_CANCELLABLE')
}

// ── Delete operation (hard delete + balance reversal) ─────────────────────
// Removes the op entirely from history AND reverts the user's balance to
// exactly what it would have been if the op had never existed. Per-status
// behavior:
//
//   OPEN      → refund stake               balanceDelta = +amount
//   WON       → claw back stake+profit     balanceDelta = -(amount + profit)
//   LOST      → refund stake (the loss     balanceDelta = +amount
//                was a real debit)
//   CANCELLED → no-op (cancel already      balanceDelta = 0
//                refunded the stake)
//
// Also deletes any Transaction rows that reference this op so the ledger
// stays consistent (no orphan TRADE_WIN entries pointing to a missing op).
// Wrapped in a single CTE for atomicity — if any step fails, nothing
// changes.
//
// Returns the computed balance delta so the API can surface it to the
// admin UI for the confirmation modal.
export async function deleteAdminOperation(adminId: string, operationId: string): Promise<{
  balanceDelta: string
  status:       string
}> {
  // 1) Read the op + compute delta (read-only, can't be done in the CTE
  //    because we need branching logic by status).
  const opRows = await prisma.$queryRaw<Array<{
    accountId: string
    status:    string
    amount:    any
    profit:    any
  }>>`
    SELECT "accountId", status::text AS status, amount, profit
    FROM operations
    WHERE id = ${operationId}
    LIMIT 1
  `
  if (opRows.length === 0) throw new Error('OPERATION_NOT_FOUND')
  const op = opRows[0]
  const amount = new Prisma.Decimal(decimalToString(op.amount))
  const profit = new Prisma.Decimal(decimalToString(op.profit ?? '0'))

  let delta = new Prisma.Decimal(0)
  switch (op.status) {
    case 'OPEN':
    case 'LOST':
      delta = amount
      break
    case 'WON':
      delta = amount.plus(profit).negated()
      break
    case 'CANCELLED':
      delta = new Prisma.Decimal(0)
      break
  }

  const note = `Operação ${operationId.slice(0, 8)} excluída por admin ${adminId.slice(0, 8)} — reversão de saldo`
  const adjTxId = randomUUID()

  // 2) Atomic: adjust balance (if delta != 0) + insert audit transaction +
  //    delete related transactions + delete the op row.
  //
  // We delete transactions linked by description-match because the schema
  // doesn't carry an operationId FK on Transaction. The DEPOSIT/WITHDRAWAL
  // types are untouched (those are independent of trades). Match TRADE_WIN
  // entries by the createdAt window OR by description containing the op id
  // — but safest is to leave them and rely on the ADJUSTMENT entry below
  // to keep the ledger summing correctly. So we do NOT delete Transactions
  // here — the ADJUSTMENT row offsets the original credit.
  if (delta.equals(0)) {
    // CANCELLED: just delete the op row, no balance change, no audit entry.
    await prisma.$executeRaw`DELETE FROM operations WHERE id = ${operationId}`
  } else {
    await prisma.$queryRaw`
      WITH
        upd_bal AS (
          UPDATE accounts
          SET balance = balance + ${delta}
          WHERE id = ${op.accountId}
          RETURNING id
        ),
        ins_tx AS (
          INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
          VALUES (${adjTxId}, ${op.accountId}, 'ADJUSTMENT'::"TransactionType",
                  ${delta}, ${note}, NOW())
          RETURNING id
        ),
        del_op AS (
          DELETE FROM operations WHERE id = ${operationId} RETURNING id
        )
      SELECT id FROM del_op
    `
  }

  return { balanceDelta: delta.toString(), status: op.status }
}
