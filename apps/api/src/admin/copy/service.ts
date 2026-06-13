import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'

// Admin Copy Trading — gerencia o catálogo de traders (os 8 do seed) e
// estatísticas de uso. Tudo editável; nada hardcoded no front.

export interface AdminCopyTraderRow {
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
  displayOrder:  number
  // métricas reais de uso (assinaturas ativas)
  activeCopiers: number
}

function toRow(t: any, activeCopiers: number): AdminCopyTraderRow {
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
    displayOrder:  t.displayOrder,
    activeCopiers,
  }
}

export async function listAdminTraders(): Promise<AdminCopyTraderRow[]> {
  const traders = await prisma.copyTrader.findMany({
    orderBy: [{ displayOrder: 'asc' }, { weeklyGainPct: 'desc' }],
  })
  // Contagem real de assinaturas ativas por trader (1 query).
  const agg = await prisma.userCopyTrader.groupBy({
    by:     ['traderId'],
    where:  { status: 'ACTIVE' },
    _count: { _all: true },
  })
  const aggMap = new Map(agg.map((a) => [a.traderId, a._count._all]))
  return traders.map((t) => toRow(t, aggMap.get(t.id) ?? 0))
}

// ── Assinaturas & compras (controle) ────────────────────────────────────────
export interface AdminCopySubRow {
  id:          string
  userId:      string
  userName:    string
  userEmail:   string
  traderId:    string
  traderName:  string
  paid:        boolean
  pricePaid:   number        // quanto pagou pra copiar (0 se grátis)
  status:      string        // ACTIVE | CANCELLED
  activatedAt: Date
  nextCycleAt: Date | null
  settledOps:  number        // operações já liquidadas
  settledPnl:  number        // resultado acumulado (negativo = usuário perdeu)
}

export interface AdminCopySubsResult {
  subscriptions: AdminCopySubRow[]
  summary: {
    total:      number
    active:     number
    cancelled:  number
    paid:       number
    free:       number
    revenue:    number   // soma do pricePaid (receita das compras de copys pagos)
    netUserPnl: number   // soma do pnl das ops liquidadas (negativo = casa lucrou)
  }
}

// Lista as assinaturas (compras pagas + grátis) com dados do usuário, do trader
// e o resultado acumulado das operações liquidadas. Pra admin ter controle.
export async function listAdminSubscriptions(): Promise<AdminCopySubsResult> {
  const rows = await prisma.$queryRaw<Array<any>>`
    SELECT
      s.id, s."userId", u.name AS user_name, u.email AS user_email,
      s."traderId", ct.name AS trader_name, ct.paid,
      s."pricePaid", s.status, s."activatedAt", s."nextCycleAt",
      COALESCE(agg.settled_count, 0) AS settled_count,
      COALESCE(agg.settled_pnl,   0) AS settled_pnl
    FROM user_copy_traders s
    JOIN users u         ON u.id  = s."userId"
    JOIN copy_traders ct ON ct.id = s."traderId"
    LEFT JOIN (
      SELECT "userId", "traderId",
             COUNT(*) FILTER (WHERE status = 'SETTLED') AS settled_count,
             SUM(pnl) FILTER (WHERE status = 'SETTLED') AS settled_pnl
        FROM copy_trade_operations
       GROUP BY "userId", "traderId"
    ) agg ON agg."userId" = s."userId" AND agg."traderId" = s."traderId"
    ORDER BY s."activatedAt" DESC
    LIMIT 500
  `
  const subscriptions: AdminCopySubRow[] = rows.map((r) => ({
    id:          r.id,
    userId:      r.userId,
    userName:    r.user_name,
    userEmail:   r.user_email,
    traderId:    r.traderId,
    traderName:  r.trader_name,
    paid:        r.paid,
    pricePaid:   Number(r.pricePaid),
    status:      r.status,
    activatedAt: r.activatedAt,
    nextCycleAt: r.nextCycleAt ?? null,
    settledOps:  Number(r.settled_count),
    settledPnl:  Number(r.settled_pnl),
  }))
  // netUserPnl: somar das linhas duplicaria (a agregação é por user+trader e o
  // mesmo par aparece em várias assinaturas após copiar→cancelar→copiar). Soma
  // direto da tabela de operações liquidadas → líquido real (negativo = casa lucrou).
  const netAgg = await prisma.copyTradeOperation.aggregate({
    where: { status: 'SETTLED' },
    _sum:  { pnl: true },
  })
  const summary = {
    total:      subscriptions.length,
    active:     subscriptions.filter((s) => s.status === 'ACTIVE').length,
    cancelled:  subscriptions.filter((s) => s.status === 'CANCELLED').length,
    paid:       subscriptions.filter((s) => s.paid).length,
    free:       subscriptions.filter((s) => !s.paid).length,
    revenue:    subscriptions.reduce((a, s) => a + s.pricePaid, 0),
    netUserPnl: netAgg._sum.pnl ? Number(netAgg._sum.pnl) : 0,
  }
  return { subscriptions, summary }
}

export interface UpdateTraderInput {
  name?:          string
  countryCode?:   string
  avatarUrl?:     string | null
  vip?:           boolean
  paid?:          boolean
  accessPrice?:   number
  weeklyGainPct?: number
  copiers?:       number
  copiedTrades?:  number
  commissionPct?: number
  profitPct?:     number
  lossPct?:       number
  active?:        boolean
  displayOrder?:  number
}

export async function updateTrader(id: string, input: UpdateTraderInput): Promise<AdminCopyTraderRow | null> {
  try {
    const t = await prisma.copyTrader.update({
      where: { id },
      data: {
        ...(input.name          !== undefined && { name: input.name.trim() }),
        ...(input.countryCode   !== undefined && { countryCode: input.countryCode.trim().toLowerCase() }),
        ...(input.avatarUrl     !== undefined && { avatarUrl: input.avatarUrl?.trim() || null }),
        ...(input.vip           !== undefined && { vip: input.vip }),
        ...(input.paid          !== undefined && { paid: input.paid }),
        ...(input.accessPrice   !== undefined && { accessPrice: new Prisma.Decimal(input.accessPrice) }),
        ...(input.weeklyGainPct !== undefined && { weeklyGainPct: new Prisma.Decimal(input.weeklyGainPct) }),
        ...(input.copiers       !== undefined && { copiers: input.copiers }),
        ...(input.copiedTrades  !== undefined && { copiedTrades: input.copiedTrades }),
        ...(input.commissionPct !== undefined && { commissionPct: input.commissionPct }),
        ...(input.profitPct     !== undefined && { profitPct: input.profitPct }),
        ...(input.lossPct       !== undefined && { lossPct: input.lossPct }),
        ...(input.active        !== undefined && { active: input.active }),
        ...(input.displayOrder  !== undefined && { displayOrder: input.displayOrder }),
      },
    })
    const cnt = await prisma.userCopyTrader.count({ where: { traderId: id, status: 'ACTIVE' } })
    return toRow(t, cnt)
  } catch {
    return null
  }
}
