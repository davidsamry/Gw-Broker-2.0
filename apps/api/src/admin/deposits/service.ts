import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'

// Admin deposits management. Raw SQL throughout (consistent with other
// admin services + tolerant of stale Prisma client during schema iterations).

export interface DepositRow {
  id:         string
  accountId:  string
  userId:     string
  userName:   string
  userEmail:  string
  amount:     string
  bonus:      string | null
  method:     string
  externalId: string | null
  /** 'bspay' | 'versell'. Registros antigos (NULL no banco) viram 'bspay'. */
  paymentGateway: string
  status:     'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
  isFake:     boolean
  notes:      string | null
  createdAt:  Date
  paidAt:     Date | null
}

export interface ListDepositsParams {
  page?:     number
  pageSize?: number
  search?:   string
  status?:   'ALL' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
}

export interface DepositCounts {
  total:        number
  paid:         number
  pending:      number
  totalAmount:  string  // sum of all deposits
  paidAmount:   string  // sum of PAID
  ticketAvg:    string  // avg of PAID (the "ticket médio")
}

export interface ListDepositsResponse {
  deposits: DepositRow[]
  total:    number
  page:     number
  pageSize: number
  counts:   DepositCounts
}

function decimalToString(x: any): string {
  if (x == null) return '0'
  if (typeof x === 'string') return x
  if (typeof x.toString === 'function') return x.toString()
  return String(x)
}

export async function listAdminDeposits(params: ListDepositsParams): Promise<ListDepositsResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25))
  const offset   = (page - 1) * pageSize

  const where: Prisma.Sql[] = []
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push(Prisma.sql`(u.email ILIKE ${q} OR u.name ILIKE ${q})`)
  }
  if (params.status && params.status !== 'ALL') {
    where.push(Prisma.sql`d.status = ${params.status}::"DepositStatus"`)
  }
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty

  const [rows, countRows, kpiRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT
        d.id, d."accountId",
        u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
        d.amount, d.bonus, d.method::text AS method,
        d."externalId",
        -- NULL = depósito anterior ao multi-gateway → BSPay (compatibilidade).
        COALESCE(d."paymentGateway", 'bspay') AS "paymentGateway",
        d.status::text AS status,
        d."isFake", d.notes,
        d."createdAt", d."paidAt"
      FROM deposits d
      INNER JOIN accounts a ON a.id = d."accountId"
      INNER JOIN users    u ON u.id = a."userId"
      ${whereSql}
      ORDER BY d."createdAt" DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM deposits d
      INNER JOIN accounts a ON a.id = d."accountId"
      INNER JOIN users    u ON u.id = a."userId"
      ${whereSql}
    `,
    // Global KPI block — not affected by current filter; matches the
    // header cards on the reference UI (Depósitos Gerados / Pagos / Médio).
    prisma.$queryRaw<Array<{
      total:        bigint
      paid:         bigint
      pending:      bigint
      totalAmount:  any
      paidAmount:   any
      ticketAvg:    any
    }>>`
      SELECT
        COUNT(*)::bigint                                                                  AS total,
        COUNT(*) FILTER (WHERE status = 'PAID'::"DepositStatus")::bigint                  AS paid,
        COUNT(*) FILTER (WHERE status = 'PENDING'::"DepositStatus")::bigint               AS pending,
        COALESCE(SUM(amount), 0)                                                          AS "totalAmount",
        COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'::"DepositStatus"), 0)          AS "paidAmount",
        COALESCE(AVG(amount) FILTER (WHERE status = 'PAID'::"DepositStatus"), 0)          AS "ticketAvg"
      FROM deposits
    `,
  ])

  const deposits: DepositRow[] = rows.map((r) => ({
    ...r,
    amount: decimalToString(r.amount),
    bonus:  r.bonus != null ? decimalToString(r.bonus) : null,
  }))

  const kpi = kpiRows[0]
  return {
    deposits,
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

// Mark a PENDING deposit as PAID atomically:
//   - flip status + set paidAt
//   - credit accounts.balance by (amount + bonus)
//   - write DEPOSIT ledger entry (+amount)
//   - write BONUS   ledger entry (+bonus) if bonus > 0
export async function markDepositPaid(adminId: string, depositId: string) {
  const depositTxId = randomUUID()
  const bonusTxId   = randomUUID()
  const note        = `Depósito confirmado por admin ${adminId.slice(0, 8)}`
  const bonusNote   = `Bônus de depósito confirmado por admin ${adminId.slice(0, 8)}`

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      target AS (
        SELECT id, "accountId", amount, COALESCE(bonus, 0) AS bonus
        FROM deposits
        WHERE id = ${depositId}
          AND status = 'PENDING'::"DepositStatus"
      ),
      upd_dep AS (
        UPDATE deposits
        SET status = 'PAID'::"DepositStatus",
            "paidAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id IN (SELECT id FROM target)
        RETURNING id
      ),
      upd_bal AS (
        UPDATE accounts
        SET balance = balance + (SELECT amount + bonus FROM target)
        WHERE id = (SELECT "accountId" FROM target)
        RETURNING id
      ),
      ins_dep_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${depositTxId}, "accountId", 'DEPOSIT'::"TransactionType", amount, ${note}, NOW()
        FROM target
        RETURNING id
      ),
      ins_bonus_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${bonusTxId}, "accountId", 'BONUS'::"TransactionType", bonus, ${bonusNote}, NOW()
        FROM target
        WHERE bonus > 0
        RETURNING id
      )
    SELECT id FROM upd_dep
  `

  if (rows.length === 0) throw new Error('DEPOSIT_NOT_PAYABLE')
}

export async function toggleDepositFake(depositId: string, isFake: boolean) {
  const result = await prisma.$executeRaw`
    UPDATE deposits SET "isFake" = ${isFake}, "updatedAt" = NOW()
    WHERE id = ${depositId}
  `
  if (result === 0) throw new Error('DEPOSIT_NOT_FOUND')
}
