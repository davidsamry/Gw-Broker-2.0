import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { sendEmailAsync } from '../../email/service.js'

// Admin withdrawals management. Raw SQL (consistent with other admin modules).
// User-side cancel still lives in apps/api/src/withdrawals/service.ts — this
// module only adds the admin approve / reject actions.

export interface WithdrawalRow {
  id:          string
  accountId:   string
  userId:      string
  userName:    string
  userEmail:   string
  userCpf:     string | null
  amount:      string
  method:      'PIX' | 'USDT_TRC20' | 'BANK_TRANSFER'
  destination: string
  status:      'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
  notes:       string | null
  createdAt:   Date
  processedAt: Date | null
}

export interface ListAdminWithdrawalsParams {
  page?:     number
  pageSize?: number
  search?:   string
  status?:   'ALL' | 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
}

export interface WithdrawalCounts {
  total:        number
  paid:         number  // COMPLETED
  pending:      number  // PENDING
  totalAmount:  string
  paidAmount:   string
  ticketAvg:    string  // avg of COMPLETED
}

export interface ListAdminWithdrawalsResponse {
  withdrawals: WithdrawalRow[]
  total:       number
  page:        number
  pageSize:    number
  counts:      WithdrawalCounts
}

function decimalToString(x: any): string {
  if (x == null) return '0'
  if (typeof x === 'string') return x
  if (typeof x.toString === 'function') return x.toString()
  return String(x)
}

export async function listAdminWithdrawals(params: ListAdminWithdrawalsParams): Promise<ListAdminWithdrawalsResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25))
  const offset   = (page - 1) * pageSize

  const where: Prisma.Sql[] = []
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push(Prisma.sql`(u.email ILIKE ${q} OR u.name ILIKE ${q} OR u.cpf ILIKE ${q})`)
  }
  if (params.status && params.status !== 'ALL') {
    where.push(Prisma.sql`w.status = ${params.status}::"WithdrawalStatus"`)
  }
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty

  const [rows, countRows, kpiRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT
        w.id, w."accountId",
        u.id AS "userId", u.name AS "userName", u.email AS "userEmail", u.cpf AS "userCpf",
        w.amount, w.method::text AS method, w.destination,
        w.status::text AS status, w.notes,
        w."createdAt", w."processedAt"
      FROM withdrawals w
      INNER JOIN accounts a ON a.id = w."accountId"
      INNER JOIN users    u ON u.id = a."userId"
      ${whereSql}
      ORDER BY
        CASE WHEN w.status = 'PENDING'::"WithdrawalStatus" THEN 0 ELSE 1 END,
        w."createdAt" DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM withdrawals w
      INNER JOIN accounts a ON a.id = w."accountId"
      INNER JOIN users    u ON u.id = a."userId"
      ${whereSql}
    `,
    // Global counts — not affected by filters; for the header cards.
    prisma.$queryRaw<Array<{
      total:       bigint
      paid:        bigint
      pending:     bigint
      totalAmount: any
      paidAmount:  any
      ticketAvg:   any
    }>>`
      SELECT
        COUNT(*)::bigint                                                                AS total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED'::"WithdrawalStatus")::bigint        AS paid,
        COUNT(*) FILTER (WHERE status = 'PENDING'::"WithdrawalStatus")::bigint          AS pending,
        COALESCE(SUM(amount), 0)                                                        AS "totalAmount",
        COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'::"WithdrawalStatus"), 0) AS "paidAmount",
        COALESCE(AVG(amount) FILTER (WHERE status = 'COMPLETED'::"WithdrawalStatus"), 0) AS "ticketAvg"
      FROM withdrawals
    `,
  ])

  const withdrawals: WithdrawalRow[] = rows.map((r) => ({
    ...r,
    amount: decimalToString(r.amount),
  }))

  const kpi = kpiRows[0]
  return {
    withdrawals,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
    counts: {
      total:       Number(kpi?.total ?? 0),
      paid:        Number(kpi?.paid ?? 0),
      pending:     Number(kpi?.pending ?? 0),
      totalAmount: decimalToString(kpi?.totalAmount),
      paidAmount:  decimalToString(kpi?.paidAmount),
      ticketAvg:   decimalToString(kpi?.ticketAvg),
    },
  }
}

// Approve a PENDING withdrawal: marks COMPLETED.
// Balance was already debited at creation time — nothing else to do here.
// A future cashout integration (BSPay) would replace this with a real
// API call + COMPLETED set only on gateway confirmation.
export async function approveWithdrawal(adminId: string, withdrawalId: string) {
  const note = `Aprovado por admin ${adminId.slice(0, 8)}`
  const result = await prisma.$executeRaw`
    UPDATE withdrawals
    SET status = 'COMPLETED'::"WithdrawalStatus",
        "processedAt" = NOW(),
        "updatedAt"   = NOW(),
        notes         = CASE WHEN notes IS NULL THEN ${note} ELSE notes || ' · ' || ${note} END
    WHERE id = ${withdrawalId}
      AND status = 'PENDING'::"WithdrawalStatus"
  `
  if (result === 0) throw new Error('WITHDRAWAL_NOT_PENDING')
  await notifyWithdrawalResult(withdrawalId, 'APPROVED')
}

// Reject a PENDING withdrawal: refund balance + insert refund transaction
// + mark CANCELLED with reason. Single atomic CTE.
export async function rejectWithdrawal(adminId: string, withdrawalId: string, reason: string) {
  const refundTxId = randomUUID()
  const note       = `Cancelado por admin ${adminId.slice(0, 8)} — ${reason}`

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      target AS (
        SELECT id, "accountId", amount
        FROM withdrawals
        WHERE id = ${withdrawalId}
          AND status = 'PENDING'::"WithdrawalStatus"
      ),
      upd_wd AS (
        UPDATE withdrawals
        SET status        = 'CANCELLED'::"WithdrawalStatus",
            "processedAt" = NOW(),
            "updatedAt"   = NOW(),
            notes         = ${note}
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
        SELECT ${refundTxId}, "accountId", 'WITHDRAWAL'::"TransactionType", amount, ${note}, NOW()
        FROM target
        RETURNING id
      )
    SELECT id FROM upd_wd
  `
  if (rows.length === 0) throw new Error('WITHDRAWAL_NOT_PENDING')
  await notifyWithdrawalResult(withdrawalId, 'REJECTED', reason)
}

async function notifyWithdrawalResult(withdrawalId: string, outcome: 'APPROVED' | 'REJECTED', reason?: string): Promise<void> {
  try {
    const info = await prisma.$queryRaw<Array<{
      email: string; name: string; amount: string
    }>>`
      SELECT u.email, u.name, w.amount::text AS amount
      FROM withdrawals w
      JOIN accounts a ON a.id = w."accountId"
      JOIN users    u ON u.id = a."userId"
      WHERE w.id = ${withdrawalId}
      LIMIT 1
    `
    const row = info[0]
    if (!row) return
    sendEmailAsync({
      templateKey: outcome === 'APPROVED' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
      to:          row.email,
      vars:        {
        name:   row.name,
        amount: Number(row.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        reason: reason ?? '',
      },
    })
  } catch (err) {
    console.error(`[admin/withdrawals] notify ${outcome} email lookup failed`, err)
  }
}
