import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { buildUserSearchSql } from '../users/service.js'

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
  // null pra linhas de Copy Trading/compra — não têm direção binária.
  direction:    'CALL' | 'PUT' | null
  amount:       string
  payout:       number
  // null pra linhas de Copy Trading/compra — não têm preço de entrada/saída.
  entryPrice:   string | null
  exitPrice:    string | null
  profit:       string | null
  // 'PURCHASE' = compra de acesso a um Copy Trader (débito único, sem
  // resultado ganhou/perdeu). Só aparece na consulta por usuário.
  status:       'OPEN' | 'WON' | 'LOST' | 'CANCELLED' | 'PURCHASE'
  expiresAt:    Date
  openedAt:     Date
  closedAt:     Date | null
  /** Computed: round(expiresAt - openedAt) in seconds — for "Timeframe" col */
  timeframeSec: number
  // TRADE = operação binária normal (tabela operations, comportamento
  // default quando ausente). COPY = operação copiada (copy_trade_operations).
  // COPY_PURCHASE = débito de compra de acesso a um trader pago.
  kind?:        'TRADE' | 'COPY' | 'COPY_PURCHASE'
}

export interface ListOperationsParams {
  page?:        number
  pageSize?:    number
  search?:      string
  status?:      'ALL' | 'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  accountType?: 'ALL' | 'REAL' | 'DEMO'
  /** Filtra so' as ops de UM usuario especifico (drawer "Detalhes do Usuario") */
  userId?:      string
  /**
   * Fonte das linhas. ALL (default) une trades + copy + compras de copy.
   * TRADE isola so' as operacoes binarias (comportamento pre-copy), util
   * quando o volume de copy domina a primeira pagina.
   */
  kind?:        'ALL' | 'TRADE' | 'COPY' | 'COPY_PURCHASE'
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

// Monta o SELECT unificado das 3 fontes que impactam o extrato do usuário:
//
//   1. operations           → trades binários normais          (kind='TRADE')
//   2. copy_trade_operations→ operações copiadas (Copy Trading)(kind='COPY')
//   3. transactions COPY_PURCHASE → débito da compra de acesso (kind='COPY_PURCHASE')
//
// As 2 e 3 vivem em tabelas separadas (módulo de copy é isolado, sem FK com
// operations), então unimos via UNION ALL normalizando as colunas. Copy ops
// só existem na conta REAL, e o status é mapeado pro vocabulário da tela:
// PENDING→OPEN, SETTLED+WIN→WON, SETTLED+LOSS→LOST, CANCELLED→CANCELLED.
function buildUnifiedSql(params: ListOperationsParams): Prisma.Sql {
  const status      = params.status      && params.status      !== 'ALL' ? params.status      : null
  const accountType = params.accountType && params.accountType !== 'ALL' ? params.accountType : null
  const search      = params.search?.trim() ? `%${params.search.trim()}%` : null
  // Mesmo filtro de usuário da tela de Usuários (nome/sobrenome, e-mail,
  // CPF com ou sem máscara e telefone) — aqui somado ao ativo.
  const buscaUser   = params.search?.trim() ? buildUserSearchSql(params.search) : null

  // ── 1) Trades binários ────────────────────────────────────────────────
  const tradeWhere: Prisma.Sql[] = []
  if (search && buscaUser) tradeWhere.push(Prisma.sql`(${buscaUser} OR o."assetSymbol" ILIKE ${search})`)
  if (status)            tradeWhere.push(Prisma.sql`o.status = ${status}::"OperationStatus"`)
  if (accountType)       tradeWhere.push(Prisma.sql`a.type = ${accountType}::"AccountType"`)
  if (params.userId)     tradeWhere.push(Prisma.sql`u.id = ${params.userId}`)
  const tradeWhereSql = tradeWhere.length ? Prisma.sql`WHERE ${Prisma.join(tradeWhere, ' AND ')}` : Prisma.empty

  const tradeSql = Prisma.sql`
    SELECT
      o.id, o."accountId", a.type::text AS "accountType",
      u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
      o."assetId", o."assetSymbol", o."marketSymbol",
      o.direction::text AS direction,
      o.amount, o.payout,
      o."entryPrice"::text AS "entryPrice", o."exitPrice"::text AS "exitPrice",
      o.profit,
      o.status::text AS status,
      o."expiresAt", o."openedAt", o."closedAt",
      EXTRACT(EPOCH FROM (o."expiresAt" - o."openedAt"))::int AS "timeframeSec",
      'TRADE' AS kind
    FROM operations o
    INNER JOIN accounts a ON a.id = o."accountId"
    INNER JOIN users    u ON u.id = a."userId"
    ${tradeWhereSql}
  `

  const kind = params.kind ?? 'ALL'
  if (kind === 'TRADE') return tradeSql
  // Copy só existe em conta REAL — se o filtro pede DEMO, nem entra no UNION.
  if (accountType === 'DEMO') return tradeSql

  // ── 2) Operações de Copy Trading ──────────────────────────────────────
  const copyWhere: Prisma.Sql[] = []
  if (search && buscaUser) copyWhere.push(Prisma.sql`(${buscaUser} OR ct.name ILIKE ${search})`)
  if (params.userId) copyWhere.push(Prisma.sql`u.id = ${params.userId}`)
  if (status === 'OPEN')      copyWhere.push(Prisma.sql`c.status = 'PENDING'`)
  if (status === 'CANCELLED') copyWhere.push(Prisma.sql`c.status = 'CANCELLED'`)
  if (status === 'WON')       copyWhere.push(Prisma.sql`(c.status = 'SETTLED' AND c.result = 'WIN')`)
  if (status === 'LOST')      copyWhere.push(Prisma.sql`(c.status = 'SETTLED' AND c.result = 'LOSS')`)
  const copyWhereSql = copyWhere.length ? Prisma.sql`WHERE ${Prisma.join(copyWhere, ' AND ')}` : Prisma.empty

  const copySql = Prisma.sql`
    SELECT
      c.id, a.id AS "accountId", 'REAL' AS "accountType",
      u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
      ct.id AS "assetId", ct.name AS "assetSymbol", NULL AS "marketSymbol",
      NULL AS direction,
      c.amount, 0 AS payout,
      NULL AS "entryPrice", NULL AS "exitPrice",
      CASE WHEN c.status = 'SETTLED' THEN c.pnl ELSE NULL END AS profit,
      CASE
        WHEN c.status = 'PENDING'   THEN 'OPEN'
        WHEN c.status = 'CANCELLED' THEN 'CANCELLED'
        WHEN c.result = 'WIN'       THEN 'WON'
        ELSE 'LOST'
      END AS status,
      c."scheduledAt" AS "expiresAt", c."scheduledAt" AS "openedAt", c."settledAt" AS "closedAt",
      0 AS "timeframeSec",
      'COPY' AS kind
    FROM copy_trade_operations c
    INNER JOIN users        u  ON u.id = c."userId"
    INNER JOIN copy_traders ct ON ct.id = c."traderId"
    INNER JOIN accounts     a  ON a."userId" = u.id AND a.type = 'REAL'::"AccountType"
    ${copyWhereSql}
  `

  if (kind === 'COPY') return copySql

  // ── 3) Compras de acesso (débito) ─────────────────────────────────────
  // Só entram quando não há filtro de status — "PURCHASE" não é um dos
  // status da tela (não é ganhou/perdeu/aguardando).
  if (status && kind !== 'COPY_PURCHASE') return Prisma.sql`${tradeSql} UNION ALL ${copySql}`

  const purchaseWhere: Prisma.Sql[] = [Prisma.sql`t.type = 'COPY_PURCHASE'::"TransactionType"`]
  if (search && buscaUser) purchaseWhere.push(Prisma.sql`(${buscaUser} OR t.description ILIKE ${search})`)
  if (params.userId) purchaseWhere.push(Prisma.sql`u.id = ${params.userId}`)
  const purchaseWhereSql = Prisma.sql`WHERE ${Prisma.join(purchaseWhere, ' AND ')}`

  const purchaseSql = Prisma.sql`
    SELECT
      t.id, t."accountId", a.type::text AS "accountType",
      u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
      '' AS "assetId", COALESCE(t.description, 'Compra de Copy Trader') AS "assetSymbol", NULL AS "marketSymbol",
      NULL AS direction,
      ABS(t.amount) AS amount, 0 AS payout,
      NULL AS "entryPrice", NULL AS "exitPrice",
      t.amount AS profit,
      'PURCHASE' AS status,
      t."createdAt" AS "expiresAt", t."createdAt" AS "openedAt", t."createdAt" AS "closedAt",
      0 AS "timeframeSec",
      'COPY_PURCHASE' AS kind
    FROM transactions t
    INNER JOIN accounts a ON a.id = t."accountId"
    INNER JOIN users    u ON u.id = a."userId"
    ${purchaseWhereSql}
  `

  if (kind === 'COPY_PURCHASE') return purchaseSql

  return Prisma.sql`${tradeSql} UNION ALL ${copySql} UNION ALL ${purchaseSql}`
}

export async function listAdminOperations(params: ListOperationsParams): Promise<ListOperationsResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25))
  const offset   = (page - 1) * pageSize

  const unified = buildUnifiedSql(params)

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT * FROM (${unified}) AS unified
      ORDER BY "openedAt" DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM (${unified}) AS unified
    `,
  ])

  const operations: OperationRow[] = rows.map((r) => ({
    ...r,
    amount:     decimalToString(r.amount),
    entryPrice: r.entryPrice != null ? decimalToString(r.entryPrice) : null,
    exitPrice:  r.exitPrice  != null ? decimalToString(r.exitPrice)  : null,
    profit:     r.profit     != null ? decimalToString(r.profit)     : null,
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

// ── Bulk delete: TODAS as operacoes de UM usuario ─────────────────────────
// Usado pelo botao "Excluir Todos os Trades" no drawer de detalhes
// (/admin/operacoes → clique no nome). Aplica a mesma logica de reverse
// balance que deleteAdminOperation, mas em batch:
//
//   1. Le todas as ops do user (todos os status, todas as accounts)
//   2. Agrupa por accountId pra computar o delta total por account
//      (um user pode ter REAL + DEMO; cada uma tem seu proprio saldo)
//   3. Em UMA transacao:
//      - Para cada account com delta != 0: UPDATE balance + INSERT ADJUSTMENT
//      - DELETE em massa de todas as ops
//
// Por que transacao explicita em vez de CTE: precisamos branchear o computo
// do delta por status no JS antes de executar. Tudo num $transaction(async tx)
// pra garantir atomicidade (ou rola tudo, ou nada).
//
// Retorna { deletedCount, totalBalanceDelta } pra audit log + UI mostrar
// "X ops excluidas, saldo ajustado em R$ Y".

export async function deleteAllUserOperations(
  adminId: string,
  userId:  string,
): Promise<{ deletedCount: number; totalBalanceDelta: string }> {
  // 1) Le todas as ops do user (qualquer status, qualquer account)
  const ops = await prisma.$queryRaw<Array<{
    id:        string
    accountId: string
    status:    string
    amount:    any
    profit:    any
  }>>`
    SELECT o.id, o."accountId", o.status::text AS status, o.amount, o.profit
    FROM operations o
    INNER JOIN accounts a ON a.id = o."accountId"
    WHERE a."userId" = ${userId}
  `
  if (ops.length === 0) return { deletedCount: 0, totalBalanceDelta: '0' }

  // 2) Calcula o delta total por account
  const deltaByAccount = new Map<string, Prisma.Decimal>()
  const opsCountByAccount = new Map<string, number>()
  for (const op of ops) {
    const amount = new Prisma.Decimal(decimalToString(op.amount))
    const profit = new Prisma.Decimal(decimalToString(op.profit ?? '0'))
    let delta = new Prisma.Decimal(0)
    switch (op.status) {
      case 'OPEN':
      case 'LOST':
        delta = amount                          // devolve o stake
        break
      case 'WON':
        delta = amount.plus(profit).negated()   // estorna stake + lucro pago
        break
      case 'CANCELLED':
        delta = new Prisma.Decimal(0)           // cancel ja devolveu, no-op
        break
    }
    deltaByAccount.set(
      op.accountId,
      (deltaByAccount.get(op.accountId) ?? new Prisma.Decimal(0)).plus(delta),
    )
    opsCountByAccount.set(op.accountId, (opsCountByAccount.get(op.accountId) ?? 0) + 1)
  }

  // 3) Transacao atomica
  let totalDelta = new Prisma.Decimal(0)
  await prisma.$transaction(async (tx) => {
    for (const [accountId, delta] of deltaByAccount) {
      if (delta.equals(0)) continue
      const count = opsCountByAccount.get(accountId) ?? 0
      const adjTxId = randomUUID()
      const note    = `Exclusao em massa de ${count} operacoes por admin ${adminId.slice(0, 8)} — reversao de saldo`
      await tx.$executeRaw`
        UPDATE accounts SET balance = balance + ${delta} WHERE id = ${accountId}
      `
      await tx.$executeRaw`
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        VALUES (${adjTxId}, ${accountId}, 'ADJUSTMENT'::"TransactionType",
                ${delta}, ${note}, NOW())
      `
      totalDelta = totalDelta.plus(delta)
    }
    // Delete em massa — apos o ajuste de saldo, ledger fica consistente.
    await tx.$executeRaw`
      DELETE FROM operations
      WHERE "accountId" IN (SELECT id FROM accounts WHERE "userId" = ${userId})
    `
  })

  return {
    deletedCount:      ops.length,
    totalBalanceDelta: totalDelta.toString(),
  }
}
