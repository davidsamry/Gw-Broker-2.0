import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'

// ── Copy Trading — módulo isolado ──────────────────────────────────────────
// As "operações copiadas" (copy_trade_operations) NÃO contam rollover/ranking
// (essas leem a tabela `operations`, que aqui NÃO é tocada) — mas a partir de
// 2026-06-13 elas MEXEM no saldo REAL: cada uma é agendada (1ª em 1min, demais
// a cada 30min) e o copyWorker a liquida na hora, creditando (WIN) ou debitando
// (LOSS) 10% da banca + lançando COPY_RESULT no extrato.
//
// Erros lançados como Error('CODE') — o route handler mapeia pra HTTP.

const OPS_PER_CYCLE = 5
const OPS_LOSS      = 3
const OPS_WIN       = 2                  // OPS_PER_CYCLE - OPS_LOSS
const OP_FRACTION   = 0.10               // valor de cada op = 10% da banca (no início do ciclo)
const FIRST_OP_DELAY_MS = 60_000         // 1ª op cai em 1 min (e é sempre WIN)
const OP_INTERVAL_MS    = 30 * 60_000    // demais ops a cada 30 min
const CYCLE_SPAN_MS     = FIRST_OP_DELAY_MS + (OPS_PER_CYCLE - 1) * OP_INTERVAL_MS  // ~121min (1ª + 4×30min)
const RESTART_DELAY_MS  = 24 * 60 * 60 * 1000   // ciclo recorrente: novo ciclo 24h DEPOIS do anterior terminar

// Quando o próximo ciclo deve começar, a partir de `fromMs` (início do ciclo
// atual): fim do ciclo (CYCLE_SPAN) + 24h.
function nextCycleAtFrom(fromMs: number): Date {
  return new Date(fromMs + CYCLE_SPAN_MS + RESTART_DELAY_MS)
}

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
  opsGenerated:   number       // ops JÁ liquidadas (que apareceram)
  accumulated:    number       // soma dos pnl das ops liquidadas
  nextOpAt:       Date | null  // quando cai a próxima op pendente (ou null)
  operations:     CopyOpRow[]  // histórico das ops liquidadas
}

export interface CopyOpRow {
  id:        string
  result:    string   // 'WIN' | 'LOSS'
  amount:    number
  pnl:       number
  settledAt: Date     // quando a op apareceu/liquidou
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

  // Agrega só as ops JÁ liquidadas (count + soma pnl). Ops PENDING ainda não
  // "apareceram" pro usuário, então não entram no resumo nem no histórico.
  const agg = await prisma.copyTradeOperation.groupBy({
    by:      ['traderId'],
    where:   { userId, traderId: { in: traderIds }, status: 'SETTLED' },
    _count:  { _all: true },
    _sum:    { pnl: true },
  })
  const aggMap = new Map(agg.map((a) => [a.traderId, a]))

  // Histórico das ops liquidadas — ordenado por settledAt desc, agrupado por
  // trader. Limite alto (50) cobre vários ciclos.
  const settledOps = await prisma.copyTradeOperation.findMany({
    where:   { userId, traderId: { in: traderIds }, status: 'SETTLED' },
    orderBy: { settledAt: 'desc' },
    take:    traderIds.length * 50,
  })
  const opsByTrader = new Map<string, CopyOpRow[]>()
  for (const o of settledOps) {
    const list = opsByTrader.get(o.traderId) ?? []
    if (list.length < 50) {
      list.push({ id: o.id, result: o.result, amount: Number(o.amount), pnl: Number(o.pnl), settledAt: o.settledAt ?? o.createdAt })
    }
    opsByTrader.set(o.traderId, list)
  }

  // Próxima op pendente por trader (pra UI mostrar "próxima operação em ...").
  const pending = await prisma.copyTradeOperation.groupBy({
    by:     ['traderId'],
    where:  { userId, traderId: { in: traderIds }, status: 'PENDING' },
    _min:   { scheduledAt: true },
  })
  const nextMap = new Map(pending.map((p) => [p.traderId, p._min.scheduledAt ?? null]))

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
      nextOpAt:       nextMap.get(s.traderId) ?? null,
      operations:     opsByTrader.get(s.traderId) ?? [],
    }
  })
}

// Agenda 1 ciclo de 5 operações: 3 LOSS + 2 WIN em ordem 100% ALEATÓRIA (sem
// 1ª garantida — pode começar com win OU loss). 1ª op em 1min, demais a cada
// 30min. Cada op vale 10% da `bankroll` (saldo no momento), FIXO.
//
// 1 CICLO POR DIA: se já houve um ciclo desse (user, trader) nas últimas 24h
// (mesmo que o usuário tenha cancelado e recopiado), NÃO gera outro — retorna
// false. O próximo só vem pelo ciclo recorrente (restartDueCycles, 24h).
//
// Só CRIA as ops PENDING; quem mexe no saldo é o copyWorker quando cada uma
// vence (PENDING → SETTLED).
async function generateCopyOps(userId: string, traderId: string, bankroll: number): Promise<boolean> {
  const recent = await prisma.copyTradeOperation.findFirst({
    where:  { userId, traderId, createdAt: { gt: new Date(Date.now() - RESTART_DELAY_MS) } },
    select: { id: true },
  })
  if (recent) return false   // já teve ciclo hoje — 1 por dia

  const opAmount = Math.max(0, Math.round(bankroll * OP_FRACTION * 100) / 100)

  // 3 LOSS + 2 WIN, embaralhados (Fisher-Yates) — ordem imprevisível.
  const results: Array<'WIN' | 'LOSS'> = [
    ...Array<'LOSS'>(OPS_LOSS).fill('LOSS'),
    ...Array<'WIN'>(OPS_WIN).fill('WIN'),
  ]
  for (let i = results.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[results[i], results[j]] = [results[j], results[i]]
  }

  const now = Date.now()
  const rows = results.map((result, i) => ({
    id:          randomUUID(),
    userId,
    traderId,
    result,
    amount:      new Prisma.Decimal(opAmount),
    pnl:         new Prisma.Decimal(0),  // setado no settle
    status:      'PENDING',
    scheduledAt: new Date(now + FIRST_OP_DELAY_MS + i * OP_INTERVAL_MS),
    // isCopyTrade default true
  }))

  await prisma.copyTradeOperation.createMany({ data: rows })
  return true
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

  // Gera o ciclo (1 por dia — não gera se já houve um nas últimas 24h, ex.:
  // cancelou e recopiou). Valor = 10% da banca no momento. Falha aqui não
  // desfaz a assinatura — pior caso copia sem ops agendadas.
  try {
    await generateCopyOps(userId, traderId, balance)
    // Agenda o próximo ciclo 24h após o INÍCIO do ciclo de hoje (gerado agora,
    // ou um anterior do mesmo dia se recopiou) — não empurra a data ao recopiar.
    const lastOp = await prisma.copyTradeOperation.findFirst({
      where: { userId, traderId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    })
    const base = lastOp?.createdAt?.getTime() ?? Date.now()
    await prisma.userCopyTrader.update({
      where: { id: subId },
      data:  { nextCycleAt: new Date(base + CYCLE_SPAN_MS + RESTART_DELAY_MS) },
    })
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

// Liquida UMA operação de copy ATOMICAMENTE: aplica o pnl no saldo da conta
// REAL (WIN credita +amount; LOSS debita -LEAST(amount, saldo) — nunca negativo,
// respeita o CHECK balance>=0), marca SETTLED e lança COPY_RESULT no extrato.
// TRAVA a conta (FOR UPDATE) pra serializar settles concorrentes da mesma conta.
// Usado pelo copyWorker (no horário agendado) E pelo cancelCopy (fecha o ciclo
// na hora). Idempotente: só age em op status='PENDING'.
export async function settleCopyOp(opId: string, result: string, traderName: string): Promise<void> {
  const isWin = result === 'WIN'
  const desc  = `Copy Trade - ${traderName} (${isWin ? 'Ganho' : 'Perda'})`
  const txId  = randomUUID()
  await prisma.$executeRaw`
    WITH locked AS (
      SELECT a.id, a.balance
        FROM accounts a
        JOIN copy_trade_operations o ON o."userId" = a."userId"
       WHERE o.id = ${opId} AND a.type = 'REAL'
       FOR UPDATE OF a
    ),
    op AS (
      UPDATE copy_trade_operations o
         SET status      = 'SETTLED',
             "settledAt" = NOW(),
             pnl         = CASE WHEN o.result = 'WIN' THEN o.amount
                                ELSE -LEAST(o.amount, l.balance) END
        FROM locked l
       WHERE o.id = ${opId}
         AND o.status = 'PENDING'
      RETURNING o.id, l.id AS account_id, o.pnl
    ),
    upd_bal AS (
      UPDATE accounts a
         SET balance = GREATEST(0, a.balance + op.pnl)
        FROM op
       WHERE a.id = op.account_id
      RETURNING a.id
    )
    INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
    SELECT ${txId}, op.account_id, 'COPY_RESULT'::"TransactionType", op.pnl, ${desc}, NOW()
      FROM op
  `
}

// Cancela a cópia. Sem refund. ANTI-EXPLOIT (2026-06-14): NÃO descarta as
// operações PENDING do ciclo — deixa-as PENDING pro copyWorker liquidar nos
// horários agendados (a cada 30min). Assim as perdas restantes vêm NATURALMENTE
// (sem despejar tudo de uma vez) e NÃO dá pra fugir delas. Sem isso, o usuário
// copiava, embolsava a 1ª vitória garantida (+10%) e cancelava antes das perdas
// — virando impressora de dinheiro (ver igorcastro +R$1.579).
//
// Cancelar só impede NOVOS ciclos: status CANCELLED + nextCycleAt=null faz o
// restartDueCycles ignorar; e o settleDueCopyOps liquida a op MESMO com a
// assinatura cancelada (não filtra mais por status ACTIVE).
export async function cancelCopy(userId: string, traderId: string): Promise<void> {
  const res = await prisma.userCopyTrader.updateMany({
    where: { userId, traderId, status: 'ACTIVE' },
    data:  { status: 'CANCELLED', nextCycleAt: null },
  })
  if (res.count === 0) throw new Error('NOT_COPYING')
}

// Reinício recorrente: pra cada assinatura ACTIVE cujo nextCycleAt já venceu
// (24h após o ciclo anterior terminar), gera um NOVO ciclo de 5 ops (3 LOSS +
// 2 WIN, ordem aleatória), valor = 10% do saldo REAL ATUAL. O generateCopyOps
// tem trava de 1/dia, então não duplica. Chamado pelo copyWorker a cada tick.
//
// Claim atômico: o UPDATE zera nextCycleAt e RETORNA as linhas pegas — duas
// instâncias do worker não geram o mesmo ciclo 2x (a 2ª pega 0 linhas).
export async function restartDueCycles(): Promise<number> {
  const claimed = await prisma.$queryRaw<Array<{ id: string; userId: string; traderId: string }>>`
    UPDATE user_copy_traders
       SET "nextCycleAt" = NULL, "updatedAt" = NOW()
     WHERE status = 'ACTIVE' AND "nextCycleAt" IS NOT NULL AND "nextCycleAt" <= NOW()
    RETURNING id, "userId", "traderId"
  `
  let started = 0
  for (const sub of claimed) {
    try {
      const account = await prisma.account.findFirst({
        where:  { userId: sub.userId, type: 'REAL' },
        select: { balance: true },
      })
      const balance = account ? Number(account.balance) : 0
      // Sem saldo → não gera ops (evita ciclo de R$0); só reagenda pra tentar
      // de novo. Com saldo → novo ciclo com 10% do saldo atual.
      if (balance > 0) {
        const gen = await generateCopyOps(sub.userId, sub.traderId, balance)
        if (gen) started++
      }
      await prisma.userCopyTrader.update({
        where: { id: sub.id },
        data:  { nextCycleAt: nextCycleAtFrom(Date.now()) },
      })
    } catch (err) {
      console.error('[copy] restartDueCycles falhou p/ assinatura', { subId: sub.id, err })
      // reagenda pra ~1h pra não perder a assinatura
      await prisma.userCopyTrader.update({
        where: { id: sub.id },
        data:  { nextCycleAt: new Date(Date.now() + 3_600_000) },
      }).catch(() => {})
    }
  }
  return started
}
