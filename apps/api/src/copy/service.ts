import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'

// ── Copy Trading — módulo isolado ──────────────────────────────────────────
// As "operações copiadas" (copy_trade_operations) são SÓ display: nunca
// mexem em saldo, nunca viram ordem real, nunca contam rollover/ranking
// (essas leem a tabela `operations`, que aqui NÃO é tocada).
//
// Erros lançados como Error('CODE') — o route handler mapeia pra HTTP.

const OPS_PER_CYCLE = 5
const OPS_LOSS      = 3
const OPS_WIN       = 2          // OPS_PER_CYCLE - OPS_LOSS
const COPY_PAYOUT   = 0.85       // payout fictício p/ o pnl de display dos WIN

export interface CopyTraderRow {
  id:            string
  name:          string
  countryCode:   string
  avatarUrl:     string | null
  vip:           boolean
  paid:          boolean
  accessPrice:   number
  weeklyGainPct: number
  copiers:       number
  copiedTrades:  number
  commissionPct: number
  profitPct:     number
  lossPct:       number
  active:        boolean
  copied:        boolean        // o user logado já copia esse trader?
}

function toTraderRow(t: any, copiedIds: Set<string>): CopyTraderRow {
  return {
    id:            t.id,
    name:          t.name,
    countryCode:   t.countryCode,
    avatarUrl:     t.avatarUrl ?? null,
    vip:           t.vip,
    paid:          t.paid,
    accessPrice:   Number(t.accessPrice),
    weeklyGainPct: Number(t.weeklyGainPct),
    copiers:       t.copiers,
    copiedTrades:  t.copiedTrades,
    commissionPct: t.commissionPct,
    profitPct:     t.profitPct,
    lossPct:       t.lossPct,
    active:        t.active,
    copied:        copiedIds.has(t.id),
  }
}

// Lista os traders ATIVOS (ordenados por ganho semanal desc) + marca quais
// o user já copia.
export async function listTraders(userId: string): Promise<CopyTraderRow[]> {
  const [traders, subs] = await Promise.all([
    prisma.copyTrader.findMany({
      where:   { active: true },
      orderBy: [{ weeklyGainPct: 'desc' }, { displayOrder: 'asc' }],
    }),
    prisma.userCopyTrader.findMany({
      where:  { userId, status: 'ACTIVE' },
      select: { traderId: true },
    }),
  ])
  const copiedIds = new Set(subs.map((s) => s.traderId))
  return traders.map((t) => toTraderRow(t, copiedIds))
}

export interface MyTraderRow {
  subscriptionId: string
  traderId:       string
  name:           string
  countryCode:    string
  avatarUrl:      string | null
  vip:            boolean
  paid:           boolean
  activatedAt:    Date
  pricePaid:      number
  opsGenerated:   number
  accumulated:    number   // soma dos pnl das ops copiadas (display)
}

// "Meus Traders" — assinaturas ativas + resumo das ops geradas.
export async function listMyTraders(userId: string): Promise<MyTraderRow[]> {
  const subs = await prisma.userCopyTrader.findMany({
    where:   { userId, status: 'ACTIVE' },
    orderBy: { activatedAt: 'desc' },
  })
  if (subs.length === 0) return []

  const traderIds = [...new Set(subs.map((s) => s.traderId))]
  const traders = await prisma.copyTrader.findMany({ where: { id: { in: traderIds } } })
  const traderMap = new Map(traders.map((t) => [t.id, t]))

  // Agrega ops por trader (count + soma pnl) numa query só.
  const agg = await prisma.copyTradeOperation.groupBy({
    by:      ['traderId'],
    where:   { userId, traderId: { in: traderIds } },
    _count:  { _all: true },
    _sum:    { pnl: true },
  })
  const aggMap = new Map(agg.map((a) => [a.traderId, a]))

  return subs.map((s) => {
    const t = traderMap.get(s.traderId)
    const a = aggMap.get(s.traderId)
    return {
      subscriptionId: s.id,
      traderId:       s.traderId,
      name:           t?.name ?? '—',
      countryCode:    t?.countryCode ?? 'br',
      avatarUrl:      t?.avatarUrl ?? null,
      vip:            t?.vip ?? false,
      paid:           t?.paid ?? false,
      activatedAt:    s.activatedAt,
      pricePaid:      Number(s.pricePaid),
      opsGenerated:   a?._count._all ?? 0,
      accumulated:    a?._sum.pnl ? Number(a._sum.pnl) : 0,
    }
  })
}

// Gera as 5 operações copiadas (3 LOSS + 2 WIN, embaralhadas). Display-only.
async function generateCopyOps(userId: string, traderId: string): Promise<void> {
  const results: Array<'WIN' | 'LOSS'> = [
    ...Array<'LOSS'>(OPS_LOSS).fill('LOSS'),
    ...Array<'WIN'>(OPS_WIN).fill('WIN'),
  ]
  // Fisher-Yates shuffle pra ordem imprevisível.
  for (let i = results.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[results[i], results[j]] = [results[j], results[i]]
  }

  const rows = results.map((result) => {
    const stake = Math.round((20 + Math.random() * 80) * 100) / 100 // 20..100
    const pnl = result === 'WIN'
      ? Math.round(stake * COPY_PAYOUT * 100) / 100
      : -stake
    return {
      id:        randomUUID(),
      userId,
      traderId,
      result,
      amount:    new Prisma.Decimal(stake),
      pnl:       new Prisma.Decimal(pnl),
      // isCopyTrade default true
    }
  })

  await prisma.copyTradeOperation.createMany({ data: rows })
}

export interface CopyResult {
  subscriptionId: string
  paid:           boolean
  pricePaid:      number
  opsGenerated:   number
}

// Copia/assina um trader. Gratuito: exige saldo > 0. Pago: debita accessPrice
// do balance da conta REAL (atômico) + registra COPY_PURCHASE no extrato.
// Depois gera as 5 ops de display. NÃO mexe em rollover.
export async function copyTrader(userId: string, traderId: string): Promise<CopyResult> {
  const trader = await prisma.copyTrader.findUnique({ where: { id: traderId } })
  if (!trader || !trader.active) throw new Error('TRADER_NOT_FOUND')

  // Já copia? (1 assinatura ativa por par)
  const existing = await prisma.userCopyTrader.findFirst({
    where: { userId, traderId, status: 'ACTIVE' },
  })
  if (existing) throw new Error('ALREADY_COPYING')

  const account = await prisma.account.findFirst({
    where:  { userId, type: 'REAL' },
    select: { id: true, balance: true },
  })
  if (!account) throw new Error('REAL_ACCOUNT_NOT_FOUND')

  const balance = Number(account.balance)
  const price   = Number(trader.accessPrice)
  const subId   = randomUUID()

  if (trader.paid) {
    // ── PAGO: precisa de saldo >= preço. Débito atômico + extrato + sub. ──
    if (balance < price) throw new Error('INSUFFICIENT_BALANCE')

    const priceDec = new Prisma.Decimal(price)
    const negPrice = new Prisma.Decimal(-price)
    const txId     = randomUUID()
    const desc     = `Compra de Copy Trader - ${trader.name}`

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH valid AS (
        SELECT id FROM accounts
        WHERE id = ${account.id} AND "userId" = ${userId} AND balance >= ${priceDec}
      ),
      upd_bal AS (
        UPDATE accounts SET balance = balance - ${priceDec}
        WHERE id IN (SELECT id FROM valid) RETURNING id
      ),
      ins_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${txId}, id, 'COPY_PURCHASE'::"TransactionType", ${negPrice}, ${desc}, NOW()
        FROM valid RETURNING id
      ),
      ins_sub AS (
        INSERT INTO user_copy_traders
          (id, "userId", "traderId", "activatedAt", "pricePaid", status, "createdAt", "updatedAt")
        SELECT ${subId}, ${userId}, ${traderId}, NOW(), ${priceDec}, 'ACTIVE', NOW(), NOW()
        FROM valid RETURNING id
      )
      SELECT id FROM ins_sub
    `
    if (rows.length === 0) throw new Error('INSUFFICIENT_BALANCE')
  } else {
    // ── GRATUITO: só exige ter saldo (> 0). Sem débito. ──
    if (balance <= 0) throw new Error('NO_BALANCE')
    await prisma.userCopyTrader.create({
      data: { id: subId, userId, traderId, pricePaid: new Prisma.Decimal(0), status: 'ACTIVE' },
    })
  }

  // Gera as 5 ops de display (fora do caminho financeiro). Falha aqui não
  // desfaz a assinatura — pior caso o usuário copia sem ops geradas (raro).
  try {
    await generateCopyOps(userId, traderId)
  } catch (err) {
    console.error('[copy] generateCopyOps falhou (non-fatal)', { userId, traderId, err })
  }

  return {
    subscriptionId: subId,
    paid:           trader.paid,
    pricePaid:      trader.paid ? price : 0,
    opsGenerated:   OPS_PER_CYCLE,
  }
}

// Cancela a cópia (status CANCELLED). Sem refund.
export async function cancelCopy(userId: string, traderId: string): Promise<void> {
  const res = await prisma.userCopyTrader.updateMany({
    where: { userId, traderId, status: 'ACTIVE' },
    data:  { status: 'CANCELLED' },
  })
  if (res.count === 0) throw new Error('NOT_COPYING')
}
