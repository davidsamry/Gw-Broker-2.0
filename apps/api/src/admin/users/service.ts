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
  isFake:           boolean
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
               u.blocked, u."isFake", u."twoFactorEnabled", u."createdAt"
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
    // Admin-edit-drawer fields (migration 20260526000000_admin_user_edit_fields)
    isFake: boolean; copyTraderEnabled: boolean
    liquidityMode: boolean
    payoutOverrideForex: number | null; payoutOverrideOtc: number | null; payoutOverrideCrypto: number | null
    canTradeForex: boolean; canTradeOtc: boolean; canTradeCrypto: boolean
    createdAt: Date; updatedAt: Date
  }>>`
    SELECT id, name, email, role::text AS role, "kycStatus"::text AS "kycStatus",
           blocked, "blockedAt", "blockedReason", "twoFactorEnabled",
           nickname, "lastName", "birthDate", cpf, phone, country, address,
           "isFake", "copyTraderEnabled", "liquidityMode",
           "payoutOverrideForex", "payoutOverrideOtc", "payoutOverrideCrypto",
           "canTradeForex", "canTradeOtc", "canTradeCrypto",
           "createdAt", "updatedAt"
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `
  const user = userRows[0]
  if (!user) throw new Error('USER_NOT_FOUND')

  const [accounts, operations, transactions, withdrawals] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; type: string; balance: any; bonusBalance: any; rolloverRequired: any; rolloverProgress: any; currency: string; createdAt: Date }>>`
      SELECT id, type::text AS type, balance,
             "bonusBalance", "rolloverRequired", "rolloverProgress",
             currency, "createdAt"
      FROM accounts WHERE "userId" = ${userId}
    `,
    prisma.$queryRaw<any[]>`
      SELECT o.id, o."assetSymbol", o.direction::text AS direction, o.amount, o.payout,
             o."entryPrice", o."exitPrice", o.profit, o.status::text AS status,
             o."openedAt", o."closedAt", o."expiresAt",
             a.type::text AS "accountType"
      FROM operations o INNER JOIN accounts a ON a.id = o."accountId"
      WHERE a."userId" = ${userId}
      ORDER BY o."openedAt" DESC LIMIT 50
    `,
    prisma.$queryRaw<any[]>`
      SELECT t.id, t.type::text AS type, t.amount, t.description, t."createdAt",
             a.type::text AS "accountType"
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
    accounts: accounts.map((a) => ({
      ...a,
      balance:          decimalToString(a.balance),
      bonusBalance:     decimalToString(a.bonusBalance),
      rolloverRequired: decimalToString(a.rolloverRequired),
      rolloverProgress: decimalToString(a.rolloverProgress),
    })),
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

// ── Block / unblock + role + admin-edit-drawer fields ─────────────────────

export interface UpdateUserAdminInput {
  // Existing admin actions
  role?:          'USER' | 'ADMIN'
  blocked?:       boolean
  blockedReason?: string | null
  // Profile fields editable from the drawer
  name?:          string
  lastName?:      string | null
  email?:         string
  cpf?:           string | null
  phone?:         string | null
  // Admin toggles
  isFake?:                Boolean
  copyTraderEnabled?:     Boolean
  // "Liquidez" — force 70% of this user's operations to LOSE regardless
  // of price. Strictly per-user; only fires when set to true via this
  // admin endpoint. See operations/worker.ts for the gate.
  liquidityMode?:         Boolean
  // Per-user payout overrides (null = clear, use asset default)
  payoutOverrideForex?:   number | null
  payoutOverrideOtc?:     number | null
  payoutOverrideCrypto?:  number | null
  // Per-user market permissions
  canTradeForex?:         Boolean
  canTradeOtc?:           Boolean
  canTradeCrypto?:        Boolean
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

  // Build SET fragments. Every supported field follows the same pattern:
  // include the SQL only when the caller explicitly passed the key, so a
  // PATCH that touches "name" alone doesn't clobber unrelated columns.
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
  // Profile fields
  if (input.name      !== undefined) sets.push(Prisma.sql`name = ${input.name}`)
  if (input.lastName  !== undefined) sets.push(Prisma.sql`"lastName" = ${input.lastName}`)
  if (input.email     !== undefined) sets.push(Prisma.sql`email = ${input.email}`)
  if (input.cpf       !== undefined) sets.push(Prisma.sql`cpf = ${input.cpf}`)
  if (input.phone     !== undefined) sets.push(Prisma.sql`phone = ${input.phone}`)
  // Admin toggles
  if (input.isFake             !== undefined) sets.push(Prisma.sql`"isFake" = ${input.isFake}`)
  if (input.copyTraderEnabled  !== undefined) sets.push(Prisma.sql`"copyTraderEnabled" = ${input.copyTraderEnabled}`)
  if (input.liquidityMode      !== undefined) sets.push(Prisma.sql`"liquidityMode" = ${input.liquidityMode}`)
  // Payout overrides — DB CHECK constraint validates 0-100, NULL allowed.
  if (input.payoutOverrideForex   !== undefined) sets.push(Prisma.sql`"payoutOverrideForex" = ${input.payoutOverrideForex}`)
  if (input.payoutOverrideOtc     !== undefined) sets.push(Prisma.sql`"payoutOverrideOtc" = ${input.payoutOverrideOtc}`)
  if (input.payoutOverrideCrypto  !== undefined) sets.push(Prisma.sql`"payoutOverrideCrypto" = ${input.payoutOverrideCrypto}`)
  // Market permissions
  if (input.canTradeForex   !== undefined) sets.push(Prisma.sql`"canTradeForex" = ${input.canTradeForex}`)
  if (input.canTradeOtc     !== undefined) sets.push(Prisma.sql`"canTradeOtc" = ${input.canTradeOtc}`)
  if (input.canTradeCrypto  !== undefined) sets.push(Prisma.sql`"canTradeCrypto" = ${input.canTradeCrypto}`)

  if (sets.length === 0) return null

  sets.push(Prisma.sql`"updatedAt" = NOW()`)

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE users SET ${Prisma.join(sets, ', ')}
      WHERE id = ${targetUserId}
      RETURNING id
    `
    if (rows.length === 0) throw new Error('USER_NOT_FOUND')
  } catch (err: any) {
    // Surface the email-unique violation as a meaningful error code
    // so the frontend can show "Email já em uso" instead of generic 500.
    if (err?.code === 'P2002' || /unique/i.test(err?.message ?? '')) {
      throw new Error('EMAIL_ALREADY_IN_USE')
    }
    throw err
  }

  // Refetch for response.
  return getUserDetail(targetUserId)
}

// ── Bonus / rollover edit (per-account) ────────────────────────────────────

export interface UpdateBonusInput {
  // Account these values apply to. Typically the user's REAL account.
  accountId:         string
  bonusBalance?:     number
  rolloverRequired?: number
  rolloverProgress?: number
}

export async function updateUserBonus(targetUserId: string, input: UpdateBonusInput) {
  const sets: Prisma.Sql[] = []
  if (input.bonusBalance !== undefined) {
    sets.push(Prisma.sql`"bonusBalance" = ${new Prisma.Decimal(input.bonusBalance)}`)
  }
  if (input.rolloverRequired !== undefined) {
    sets.push(Prisma.sql`"rolloverRequired" = ${new Prisma.Decimal(input.rolloverRequired)}`)
  }
  if (input.rolloverProgress !== undefined) {
    sets.push(Prisma.sql`"rolloverProgress" = ${new Prisma.Decimal(input.rolloverProgress)}`)
  }
  if (sets.length === 0) return null

  sets.push(Prisma.sql`"updatedAt" = NOW()`)

  // Defense in depth: tie the update to the targetUserId via the JOIN
  // so a forged accountId from another user can't bypass authorization.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE accounts SET ${Prisma.join(sets, ', ')}
    WHERE id = ${input.accountId} AND "userId" = ${targetUserId}
    RETURNING id
  `
  if (rows.length === 0) throw new Error('ACCOUNT_NOT_FOUND')

  return getUserDetail(targetUserId)
}

// ── Reset password ─────────────────────────────────────────────────────────
// Admin-forced password reset. The new password is bcrypt-hashed here and
// stored directly — same hashing used by the auth/register flow. Returns
// success indicator; the admin is responsible for communicating the new
// password to the user out-of-band.

import { hash } from 'bcryptjs'

export async function resetUserPassword(targetUserId: string, newPassword: string) {
  if (newPassword.length < 6) throw new Error('PASSWORD_TOO_SHORT')

  const hashed = await hash(newPassword, 10)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE users SET password = ${hashed}, "updatedAt" = NOW()
    WHERE id = ${targetUserId}
    RETURNING id
  `
  if (rows.length === 0) throw new Error('USER_NOT_FOUND')

  return { ok: true }
}

// ── Impersonation ────────────────────────────────────────────────────────
// Admin gera um JWT que faz ele logar COMO o user na nova aba. Token tem:
//   - sub: targetUserId       (igual login normal — middlewares funcionam)
//   - impersonatedBy: adminId (claim extra pra audit log + futuras checks)
//   - expiresIn: 30 min       (curto — sessao impersonation NAO renova)
//
// Guarda-rails:
//   - Target user NAO pode ser ADMIN (evita lateral movement entre admins)
//   - Target user NAO pode estar bloqueado (sem sentido logar como blocked)
//   - Admin NAO pode impersonar a si proprio (no-op desnecessario)
//
// O token e' assinado pelo MESMO secret JWT da app — middleware authenticate
// existente nao precisa mudar. A claim impersonatedBy fica disponivel em
// req.user.impersonatedBy pra audit futuras actions feitas durante a sessao.

export interface ImpersonateResult {
  token:     string
  user:      { id: string; name: string; email: string }
  expiresIn: number  // segundos
}

export async function impersonateUser(
  app:          { jwt: { sign: (payload: any, opts?: any) => Promise<string> | string } },
  adminId:      string,
  targetUserId: string,
): Promise<ImpersonateResult> {
  if (adminId === targetUserId) throw new Error('CANNOT_IMPERSONATE_SELF')

  const target = await prisma.user.findUnique({
    where:  { id: targetUserId },
    select: { id: true, name: true, email: true, role: true, blocked: true },
  })
  if (!target) throw new Error('USER_NOT_FOUND')
  if (target.role === 'ADMIN') throw new Error('CANNOT_IMPERSONATE_ADMIN')
  if (target.blocked)          throw new Error('USER_BLOCKED')

  const expiresIn = 30 * 60   // 30 min
  const tokenRaw = await app.jwt.sign(
    {
      sub:             target.id,
      impersonatedBy:  adminId,
      kind:            'impersonation',
    },
    { expiresIn: `${expiresIn}s` },
  )
  // jwt.sign retorna string|Promise<string> dependendo da config — normalizamos
  const token = typeof tokenRaw === 'string' ? tokenRaw : await tokenRaw

  return {
    token,
    user:      { id: target.id, name: target.name, email: target.email },
    expiresIn,
  }
}

// ── Hard delete ───────────────────────────────────────────────────────────
// Destroys a user + everything they own. Used by /admin/usuarios drawer for
// cleaning out test accounts. Cascade behaviour relies on the FK ON DELETE
// rules set in the Prisma schema (Account, Operation, etc. all CASCADE
// from User). For tables without explicit cascade, we delete the dependents
// manually first so the User row can go.
//
// Safety rails (all server-side — UI also gates these but never trust):
//   • Cannot delete yourself — admin can't lock themselves out.
//   • Cannot delete another ADMIN — protects against admin coup. An admin
//     wanting to remove another admin must first downgrade them to USER
//     via PATCH (which already requires self-lockout check).

export interface DeleteUserResult {
  ok:           boolean
  deletedId:    string
  deletedEmail: string
}

export async function deleteUser(adminId: string, targetUserId: string): Promise<DeleteUserResult> {
  if (adminId === targetUserId) throw new Error('CANNOT_DELETE_SELF')

  const target = await prisma.user.findUnique({
    where:  { id: targetUserId },
    select: { id: true, email: true, role: true },
  })
  if (!target) throw new Error('USER_NOT_FOUND')
  if (target.role === 'ADMIN') throw new Error('CANNOT_DELETE_ADMIN')

  // Run everything in a transaction so a partial delete never leaves the
  // DB in an inconsistent state (e.g. accounts gone but operations linger).
  // Order matters: child tables that DON'T cascade from User must be wiped
  // BEFORE the parent. Most of our schema does cascade, but a few tables
  // (operations, transactions, deposits, withdrawals, kyc_submissions,
  // tickets, ticket_messages, bonus_grants, otc_admin_logs FK on adminId)
  // need explicit handling.
  await prisma.$transaction(async (tx) => {
    // Operations + transactions live on accounts, not directly on the user
    // but cascading from account → user is set up only for some FKs. To be
    // safe, wipe everything by accountId first.
    await tx.$executeRaw`
      DELETE FROM transactions
      WHERE "accountId" IN (SELECT id FROM accounts WHERE "userId" = ${targetUserId})
    `
    await tx.$executeRaw`
      DELETE FROM operations
      WHERE "accountId" IN (SELECT id FROM accounts WHERE "userId" = ${targetUserId})
    `
    await tx.$executeRaw`
      DELETE FROM deposits
      WHERE "accountId" IN (SELECT id FROM accounts WHERE "userId" = ${targetUserId})
    `
    await tx.$executeRaw`
      DELETE FROM withdrawals
      WHERE "accountId" IN (SELECT id FROM accounts WHERE "userId" = ${targetUserId})
    `
    // BonusGrant has userId + depositId directly (no accountId column).
    // The earlier query filtered by accountId which doesn't exist on this
    // table — Postgres raised "column accountId does not exist", the
    // transaction rolled back, the whole delete failed silently.
    await tx.$executeRaw`
      DELETE FROM bonus_grants WHERE "userId" = ${targetUserId}
    `
    // Clean nullable userId references in meta_events_log so the audit
    // trail doesn't carry dangling references after the user vanishes.
    // The column is String?, so NULL is allowed; no FK to enforce, but
    // setting NULL keeps reports clean.
    await tx.$executeRaw`
      UPDATE meta_events_log SET "userId" = NULL WHERE "userId" = ${targetUserId}
    `
    // user_tracking + bot_refresh_tokens have ON DELETE CASCADE FKs in
    // the DB (see schema.prisma), so they're wiped automatically when
    // the users row goes. No explicit DELETE needed for those.
    // Tickets + messages — messages reference tickets, so messages first.
    await tx.$executeRaw`
      DELETE FROM ticket_messages
      WHERE "ticketId" IN (SELECT id FROM tickets WHERE "userId" = ${targetUserId})
    `
    await tx.$executeRaw`
      DELETE FROM ticket_messages
      WHERE "authorId" = ${targetUserId}
    `
    await tx.$executeRaw`
      DELETE FROM tickets WHERE "userId" = ${targetUserId}
    `
    await tx.$executeRaw`
      DELETE FROM kyc_submissions WHERE "userId" = ${targetUserId}
    `
    await tx.$executeRaw`
      DELETE FROM password_reset_tokens WHERE "userId" = ${targetUserId}
    `
    // Accounts come after their dependents above.
    await tx.$executeRaw`
      DELETE FROM accounts WHERE "userId" = ${targetUserId}
    `
    // Finally the user row.
    await tx.$executeRaw`
      DELETE FROM users WHERE id = ${targetUserId}
    `
  })

  // Audit log (best-effort; if the otc_admin_logs schema isn't set up
  // for non-asset events the catch swallows it.)
  try {
    await prisma.$executeRaw`
      INSERT INTO otc_admin_logs ("adminId", action, "assetId", "beforeState", "afterState", "createdAt")
      VALUES (
        ${adminId},
        ${'DELETE_USER'},
        ${null},
        ${JSON.stringify({ id: target.id, email: target.email })}::jsonb,
        ${JSON.stringify({ deleted: true })}::jsonb,
        NOW()
      )
    `
  } catch (err) {
    console.error('[admin/users] audit log for DELETE_USER failed', err)
  }

  return { ok: true, deletedId: target.id, deletedEmail: target.email }
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
