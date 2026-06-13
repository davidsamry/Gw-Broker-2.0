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
