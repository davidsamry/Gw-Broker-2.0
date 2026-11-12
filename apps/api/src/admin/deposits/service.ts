import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { notifyBalanceChanged } from '../../operations/events.js'

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
  /** Quando o USUARIO se cadastrou (users.createdAt), nao o deposito.
   *  No admin isso mostra quanto tempo levou do cadastro ate' depositar —
   *  substituiu a coluna "Fake", que era um marcador que nada lia. */
  userCreatedAt: Date
}

export type DepositPeriod = 'today' | 'yesterday' | 'month' | 'all'

export interface ListDepositsParams {
  page?:     number
  pageSize?: number
  search?:   string
  status?:   'ALL' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
  /** Recorte por data de criacao, no horario de Brasilia. Default 'all'
   *  aqui; quem escolhe 'today' como padrao e' a tela. */
  period?:   DepositPeriod
}

export interface DepositCounts {
  total:        number
  paid:         number
  pending:      number
  totalAmount:  string  // sum of all deposits
  paidAmount:   string  // sum of PAID
  ticketAvg:    string  // avg of PAID (the "ticket médio")
  // Taxa de conversao = paid / (qrGenerated + deleted)
  /** PIX cujo QR chegou ao usuario: tudo menos FAILED (erro do gateway,
   *  o usuario nunca viu QR — nao e' desistencia dele). */
  qrGenerated:  number
  /** PIX excluidos pelo admin no periodo. Saem da tabela, mas eram PIX
   *  gerados e nao pagos: sem eles a conversao fica inflada (em 11/11 a
   *  tabela tinha 6 de 6 pagos; 14 tinham sido excluidos). */
  deleted:      number
}

export interface ListDepositsResponse {
  deposits: DepositRow[]
  total:    number
  page:     number
  pageSize: number
  counts:   DepositCounts
}

// Fuso do negocio. O banco grava createdAt em UTC ("timestamp without time
// zone") e o container roda em UTC: sem converter, "hoje" comecaria as 21h
// de ontem no horario de Brasilia.
const TZ = 'America/Sao_Paulo'

/** Coluna createdAt (UTC, sem fuso) convertida pro horario de Brasilia. */
function localDe(col: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})`
}

/** Condicao SQL que limita uma data LOCAL ao periodo escolhido. */
function noPeriodo(local: Prisma.Sql, period: DepositPeriod): Prisma.Sql {
  const agora = Prisma.sql`(NOW() AT TIME ZONE ${TZ})`
  switch (period) {
    case 'today':     return Prisma.sql`(${local})::date = (${agora})::date`
    case 'yesterday': return Prisma.sql`(${local})::date = (${agora})::date - 1`
    case 'month':     return Prisma.sql`date_trunc('month', ${local}) = date_trunc('month', ${agora})`
    default:          return Prisma.sql`TRUE`
  }
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

  const period = params.period ?? 'all'
  const filtroPeriodo = noPeriodo(localDe(Prisma.sql`d."createdAt"`), period)

  const where: Prisma.Sql[] = [filtroPeriodo]
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push(Prisma.sql`(u.email ILIKE ${q} OR u.name ILIKE ${q})`)
  }
  if (params.status && params.status !== 'ALL') {
    where.push(Prisma.sql`d.status = ${params.status}::"DepositStatus"`)
  }
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty

  const [rows, countRows, kpiRows, deletedRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT
        d.id, d."accountId",
        u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
        u."createdAt" AS "userCreatedAt",
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
    // KPIs dos cards. Seguem o PERIODO, mas nao a busca nem a aba de
    // status — os cards descrevem o periodo inteiro.
    prisma.$queryRaw<Array<{
      total:        bigint
      paid:         bigint
      pending:      bigint
      qrGenerated:  bigint
      totalAmount:  any
      paidAmount:   any
      ticketAvg:    any
    }>>`
      SELECT
        COUNT(*)::bigint                                                                  AS total,
        COUNT(*) FILTER (WHERE status = 'PAID'::"DepositStatus")::bigint                  AS paid,
        COUNT(*) FILTER (WHERE status = 'PENDING'::"DepositStatus")::bigint               AS pending,
        COUNT(*) FILTER (WHERE status <> 'FAILED'::"DepositStatus")::bigint               AS "qrGenerated",
        COALESCE(SUM(amount), 0)                                                          AS "totalAmount",
        COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'::"DepositStatus"), 0)          AS "paidAmount",
        COALESCE(AVG(amount) FILTER (WHERE status = 'PAID'::"DepositStatus"), 0)          AS "ticketAvg"
      FROM deposits d
      WHERE ${filtroPeriodo}
    `,
    // PIX excluidos no periodo, contados pelo log de auditoria (a linha em
    // deposits nao existe mais). Nunca sao PAID — so' PENDING, CANCELLED e
    // FAILED podem ser excluidos — entao so' entram no denominador.
    //
    // Data usada: a de criacao do PIX, gravada no log desde 12/11/2026.
    // Exclusoes anteriores nao tem esse campo e caem na data da exclusao,
    // que costuma ser o mesmo dia ou o seguinte.
    //
    // FAILED fica de fora pelo mesmo motivo do qrGenerated: o usuario nunca
    // recebeu QR.
    prisma.$queryRaw<Array<{ deleted: bigint }>>`
      SELECT COUNT(*)::bigint AS deleted
      FROM admin_audit_log l
      WHERE l."resourceType" = 'DEPOSIT'
        AND l.action = 'DELETE'
        AND COALESCE(l.before->>'status', '') <> 'FAILED'
        AND ${noPeriodo(
          Prisma.sql`(COALESCE((l.before->>'createdAt')::timestamptz, l."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})`,
          period,
        )}
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
      qrGenerated: Number(kpi?.qrGenerated ?? 0),
      deleted:     Number(deletedRows[0]?.deleted ?? 0),
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
  notifyBalanceChanged({ depositId })
}

export async function toggleDepositFake(depositId: string, isFake: boolean) {
  const result = await prisma.$executeRaw`
    UPDATE deposits SET "isFake" = ${isFake}, "updatedAt" = NOW()
    WHERE id = ${depositId}
  `
  if (result === 0) throw new Error('DEPOSIT_NOT_FOUND')
}

// Status que podem ser excluídos: nenhum deles creditou saldo.
const DELETAVEIS = new Set(['PENDING', 'CANCELLED', 'FAILED'])

// Exclui um depósito que nunca virou dinheiro — ver DELETAVEIS acima.
// PAID é o único de fora: creditou saldo e disparou webhook/Meta, apagar
// quebraria o rastro contábil. Exclusão física mesmo: não há saldo
// envolvido e a linha só polui a lista (QR code gerado e abandonado).
//
// Bônus PENDING amarrado a este depósito ficaria órfão esperando um
// pagamento que nunca vem — cancela junto. Grants ACTIVE/COMPLETED não
// existem para depósito não pago, então não há risco de mexer em bônus
// já creditado.
export async function deleteDeposit(depositId: string): Promise<{ status: string; amount: string; createdAt: Date }> {
  return prisma.$transaction(async (tx) => {
    // createdAt vai pro log de auditoria: e' o que deixa a taxa de
    // conversao contar este PIX no dia em que foi GERADO, depois que a
    // linha some da tabela.
    const rows = await tx.$queryRaw<Array<{ status: string; amount: string; createdAt: Date }>>`
      SELECT status::text AS status, amount::text AS amount, "createdAt"
      FROM deposits WHERE id = ${depositId} LIMIT 1
    `
    const dep = rows[0]
    if (!dep) throw new Error('DEPOSIT_NOT_FOUND')
    // PENDING, CANCELLED e FAILED nunca creditaram saldo — só PAID fica
    // de fora. FAILED (erro do gateway) entrou em 2026-11-05: tinha ficado
    // fora na primeira versão sem motivo, e é o caso que mais polui a
    // lista — o usuário tenta gerar o PIX, falha, e tenta de novo.
    if (!DELETAVEIS.has(dep.status)) {
      throw new Error('DEPOSIT_NOT_DELETABLE')
    }
    await tx.$executeRaw`
      UPDATE bonus_grants SET status = 'CANCELLED', "cancelledAt" = NOW()
      WHERE "depositId" = ${depositId} AND status = 'PENDING'
    `
    await tx.$executeRaw`DELETE FROM deposits WHERE id = ${depositId}`
    return dep
  })
}
