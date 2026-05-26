import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'

// Admin-side user management. All queries are raw SQL to avoid coupling to
// the regenerated Prisma client (matches the pattern used by withdrawals +
// transactions services).

// ── Types ──────────────────────────────────────────────────────────────────

export interface UserListRow {
  id:               string
  name:             string
  email:            string
  role:             'USER' | 'ADMIN'
  kycStatus:        string
  blocked:          boolean
  twoFactorEnabled: boolean
  createdAt:        Date
  realBalance:      string  // Decimal stringified
  demoBalance:      string
  totalOps:         number
  lastActivity:     Date | null
}

export interface UserListResponse {
  users:    UserListRow[]
  total:    number
  page:     number
  pageSize: number
}

export interface ListUsersParams {
  page?:     number
  pageSize?: number
  search?:   string
  role?:     'USER' | 'ADMIN' | 'ALL'
  kyc?:      'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ALL'
  blocked?:  'YES' | 'NO' | 'ALL'
}

// ── List ───────────────────────────────────────────────────────────────────

export async function listUsers(params: ListUsersParams): Promise<UserListResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 20))
  const offset   = (page - 1) * pageSize

  // WHERE-clause fragments composed via Prisma.sql tagged templates so
  // each filter is parameterized — never string-interpolated.
  const where: Prisma.Sql[] = []
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push(Prisma.sql`(u.email ILIKE ${q} OR u.name ILIKE ${q})`)
  }
  if (params.role && params.role !== 'ALL') {
    where.push(Prisma.sql`u.role = ${params.role}::"UserRole"`)
  }
  if (params.kyc && params.kyc !== 'ALL') {
    where.push(Prisma.sql`u."kycStatus" = ${params.kyc}::"KycStatus"`)
  }
  if (params.blocked && params.blocked !== 'ALL') {
    where.push(Prisma.sql`u.blocked = ${params.blocked === 'YES'}`)
  }
  const whereSql = where.length
    ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`
    : Prisma.empty

  // Two-stage query — page + filter the users table FIRST (cheap, indexed),
  // then attach balances + op counts via lateral subqueries that run only
  // for the returned 20 rows. The old single-query approach did
  // `LEFT JOIN operations` BEFORE the LIMIT, exploding cardinality to
  // `users × ops_per_user` rows before the GROUP BY collapsed them again
  // — slow + scaled badly with op volume.
  //
  // count(*) for pagination stays as a separate plain-FROM query so it
  // doesn't pay the JOIN cost either.
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<UserListRow[]>`
      WITH page_users AS (
        SELECT u.id, u.name, u.email, u.role::text AS role,
               u."kycStatus"::text AS "kycStatus",
               u.blocked, u."twoFactorEnabled", u."createdAt"
        FROM users u
        ${whereSql}
        ORDER BY u."createdAt" DESC
        LIMIT ${pageSize}
        OFFSET ${offset}
      )
      SELECT pu.*,
        COALESCE((
          SELECT a.balance FROM accounts a
          WHERE a."userId" = pu.id AND a.type = 'REAL'::"AccountType"
          LIMIT 1
        ), 0) AS "realBalance",
        COALESCE((
          SELECT a.balance FROM accounts a
          WHERE a."userId" = pu.id AND a.type = 'DEMO'::"AccountType"
          LIMIT 1
        ), 0) AS "demoBalance",
        COALESCE((
          SELECT COUNT(*)::int
          FROM operations o
          JOIN accounts a ON a.id = o."accountId"
          WHERE a."userId" = pu.id
        ), 0) AS "totalOps",
        (
          SELECT MAX(GREATEST(o."openedAt", o."closedAt"))
          FROM operations o
          JOIN accounts a ON a.id = o."accountId"
          WHERE a."userId" = pu.id
        ) AS "lastActivity"
      FROM page_users pu
      ORDER BY pu."createdAt" DESC
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM users u ${whereSql}
    `,
  ])

  // Cast Decimals + bigint for JSON safety.
  const users = rows.map((r) => ({
    ...r,
    realBalance: (r.realBalance as any).toString(),
    demoBalance: (r.demoBalance as any).toString(),
  }))

  return {
    users,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  }
}

// ── Detail ─────────────────────────────────────────────────────────────────

export async function getUserDetail(userId: string) {
  const userRows = await prisma.$queryRaw<Array<{
    id: string; name: string; email: string; role: string; kycStatus: string
    blocked: boolean; blockedAt: Date | null; blockedReason: string | null
    twoFactorEnabled: boolean
    nickname: string | null; lastName: string | null; birthDate: Date | null
    cpf: string | null; phone: string | null; country: string | null; address: string | null
    createdAt: Date; updatedAt: Date
  }>>`
    SELECT id, name, email, role::text AS role, "kycStatus"::text AS "kycStatus",
           blocked, "blockedAt", "blockedReason", "twoFactorEnabled",
           nickname, "lastName", "birthDate", cpf, phone, country, address,
           "createdAt", "updatedAt"
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `
  const user = userRows[0]
  if (!user) throw new Error('USER_NOT_FOUND')

  const [accounts, operations, transactions, withdrawals] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; type: string; balance: any; currency: string; createdAt: Date }>>`
      SELECT id, type::text AS type, balance, currency, "createdAt"
      FROM accounts WHERE "userId" = ${userId}
    `,
    prisma.$queryRaw<any[]>`
      SELECT o.id, o."assetSymbol", o.direction::text AS direction, o.amount, o.payout,
             o."entryPrice", o."exitPrice", o.profit, o.status::text AS status,
             o."openedAt", o."closedAt", o."expiresAt"
      FROM operations o INNER JOIN accounts a ON a.id = o."accountId"
      WHERE a."userId" = ${userId}
      ORDER BY o."openedAt" DESC LIMIT 50
    `,
    prisma.$queryRaw<any[]>`
      SELECT t.id, t.type::text AS type, t.amount, t.description, t."createdAt"
      FROM transactions t INNER JOIN accounts a ON a.id = t."accountId"
      WHERE a."userId" = ${userId}
      ORDER BY t."createdAt" DESC LIMIT 50
    `,
    prisma.$queryRaw<any[]>`
      SELECT w.id, w.amount, w.method::text AS method, w.destination,
             w.status::text AS status, w.notes, w."createdAt", w."processedAt"
      FROM withdrawals w INNER JOIN accounts a ON a.id = w."accountId"
      WHERE a."userId" = ${userId}
      ORDER BY w."createdAt" DESC LIMIT 50
    `,
  ])

  // Stringify Decimals.
  const decimalToString = (x: any) => x?.toString?.() ?? String(x ?? 0)

  return {
    user: {
      ...user,
      birthDate: user.birthDate ? new Date(user.birthDate).toISOString().slice(0, 10) : null,
    },
    accounts: accounts.map((a) => ({ ...a, balance: decimalToString(a.balance) })),
    operations: operations.map((o) => ({
      ...o,
      amount:     decimalToString(o.amount),
      entryPrice: decimalToString(o.entryPrice),
      exitPrice:  o.exitPrice != null ? decimalToString(o.exitPrice) : null,
      profit:     o.profit != null ? decimalToString(o.profit) : null,
    })),
    transactions: transactions.map((t) => ({ ...t, amount: decimalToString(t.amount) })),
    withdrawals: withdrawals.map((w) => ({ ...w, amount: decimalToString(w.amount) })),
  }
}

// ── Block / unblock + role ────────────────────────────────────────────────

export interface UpdateUserAdminInput {
  role?:          'USER' | 'ADMIN'
  blocked?:       boolean
  blockedReason?: string | null
}

export async function updateUserByAdmin(
  adminId: string,
  targetUserId: string,
  input: UpdateUserAdminInput,
) {
  if (adminId === targetUserId && (input.role === 'USER' || input.blocked === true)) {
    // Self-protection: admins cannot remove their own admin status or block themselves.
    throw new Error('SELF_LOCKOUT_PROTECTED')
  }

  // Build SET fragments.
  const sets: Prisma.Sql[] = []
  if (input.role !== undefined) {
    sets.push(Prisma.sql`role = ${input.role}::"UserRole"`)
  }
  if (input.blocked !== undefined) {
    sets.push(Prisma.sql`blocked = ${input.blocked}`)
    sets.push(input.blocked
      ? Prisma.sql`"blockedAt" = NOW()`
      : Prisma.sql`"blockedAt" = NULL`)
    sets.push(input.blocked && input.blockedReason
      ? Prisma.sql`"blockedReason" = ${input.blockedReason}`
      : Prisma.sql`"blockedReason" = NULL`)
  }
  if (sets.length === 0) return null

  sets.push(Prisma.sql`"updatedAt" = NOW()`)

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE users SET ${Prisma.join(sets, ', ')}
    WHERE id = ${targetUserId}
    RETURNING id
  `
  if (rows.length === 0) throw new Error('USER_NOT_FOUND')

  // Refetch for response.
  return getUserDetail(targetUserId)
}

// ── Balance adjustment ────────────────────────────────────────────────────

export interface AdjustBalanceInput {
  accountType: 'REAL' | 'DEMO'
  amount:      number   // signed: + credit, - debit
  reason:      string
}

export async function adjustUserBalance(
  adminId: string,
  targetUserId: string,
  input: AdjustBalanceInput,
) {
  const txId       = randomUUID()
  const amountDec  = new Prisma.Decimal(input.amount)
  const description = `Ajuste manual por admin ${adminId.slice(0, 8)}: ${input.reason}`

  // Single CTE: locate the target account, update its balance, insert an
  // ADJUSTMENT transaction. Refuses to drive balance negative.
  const rows = await prisma.$queryRaw<Array<{ id: string; balance: any }>>`
    WITH
      target AS (
        SELECT id, balance FROM accounts
        WHERE "userId" = ${targetUserId}
          AND type = ${input.accountType}::"AccountType"
      ),
      validated AS (
        SELECT id FROM target WHERE balance + ${amountDec} >= 0
      ),
      upd AS (
        UPDATE accounts SET balance = balance + ${amountDec}
        WHERE id IN (SELECT id FROM validated)
        RETURNING id, balance
      ),
      ins_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${txId}, id, 'ADJUSTMENT'::"TransactionType", ${amountDec}, ${description}, NOW()
        FROM validated
        RETURNING id
      )
    SELECT * FROM upd
  `

  if (rows.length === 0) {
    // Either account not found OR adjustment would drive balance negative.
    const acct = await prisma.account.findFirst({
      where: { userId: targetUserId, type: input.accountType },
      select: { balance: true },
    })
    if (!acct) throw new Error('ACCOUNT_NOT_FOUND')
    throw new Error('INSUFFICIENT_BALANCE')
  }

  return {
    accountId:  rows[0].id,
    newBalance: rows[0].balance.toString(),
  }
}
