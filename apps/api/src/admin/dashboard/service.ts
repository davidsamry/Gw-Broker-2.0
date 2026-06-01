import { prisma } from '../../prisma.js'

// All KPIs the Admin Dashboard renders. Computed in parallel from the live
// data model — operations + transactions + accounts + users. Defaults to 0
// when there's no data in the requested window, so the UI always has
// something to render (no nulls in the response).

export interface DashboardKpis {
  totalDeposits:        number
  totalWithdrawals:     number
  avgTicket:            number  // average deposit value in window
  netFlow:              number  // deposits - withdrawals
  userBalance:          number  // sum of REAL accounts balance
  userBonus:            number  // sum of BONUS transactions (all-time)
  userBalancePlusBonus: number
  totalUsers:           number
  newUsersToday:        number
  totalWagered:         number  // sum of Operation.amount in window
  platformProfit:       number  // sum of stake from LOST ops (user lost = platform won)
  platformLoss:         number  // sum of profit from WON ops (user won = we paid)
  platformNetResult:    number  // profit - loss
}

export interface DashboardCharts {
  // Donut: counts of WON/LOST in window.
  distribution: { wins: number; losses: number }
  // Area chart: daily wins/losses totals for the last 7 days (from period.to).
  last7days: Array<{ date: string; wins: number; losses: number }>
  // Horizontal bar: total operation counts (Vitórias dos usuários / Derrotas).
  operationCounts: { userWins: number; userLosses: number }
}

export interface LucrativeUser {
  id:        string
  name:      string
  email:     string
  deposited: number
  profit:    number
  netProfit: number
  // Flag pro toggle "Liquidez" inline na tabela admin. Quando true, as
  // proximas operacoes desse user passam pelo motor de liquidez forcada
  // (apps/api/src/operations/liquidityManipulation.ts).
  liquidityMode: boolean
}

export interface DashboardResponse {
  range:           { from: string; to: string }
  kpis:            DashboardKpis
  charts:          DashboardCharts
  lucrativeUsers:  LucrativeUser[]
  lucrativeCount:  number  // total count (for badge), not just the page
}

function decimalToNumber(d: any): number {
  if (d == null) return 0
  if (typeof d === 'number') return d
  if (typeof d === 'string') return parseFloat(d) || 0
  if (typeof d.toNumber === 'function') return d.toNumber()
  return parseFloat(d.toString()) || 0
}

function startOfDay(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}

export async function getDashboard(from: Date, to: Date): Promise<DashboardResponse> {
  const todayStart = startOfDay(new Date())

  // All operation + transaction queries below filter by:
  //   account.type = 'REAL'  (DEMO never counted)
  //   account.user.isFake = false  (fake users marked by admin are excluded
  //                                  from every KPI, P/L and chart — so
  //                                  admin can stage demo flows without
  //                                  polluting the real-money dashboard)
  // Prisma 6 requires the explicit `is:` wrapper for to-one relation
  // filters (no field shorthand). The `as any` lets the local TS pass
  // even when the Prisma client hasn't been regenerated locally on
  // Windows due to the EPERM dll-lock issue.
  const realNonFakeAccount: any = {
    account: { type: 'REAL', user: { is: { isFake: false } } },
  }

  const [
    depAgg,
    wdAgg,
    balanceAgg,
    bonusAgg,
    userCount,
    newUsersAgg,
    wageredAgg,
    wonOps,
    lostOps,
    closedOpsWindow,
    lucrativeRaw,
  ] = await Promise.all([
    // KPI: total deposits in window (REAL + non-fake)
    prisma.transaction.aggregate({
      _sum:  { amount: true },
      _avg:  { amount: true },
      _count: true,
      where: { type: 'DEPOSIT', createdAt: { gte: from, lte: to }, ...realNonFakeAccount },
    }),
    // KPI: total withdrawals in window (REAL + non-fake — sum of -amount → flip sign)
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { type: 'WITHDRAWAL', createdAt: { gte: from, lte: to }, ...realNonFakeAccount },
    }),
    // KPI: total REAL balance (all-time, non-fake users only)
    prisma.account.aggregate({
      _sum: { balance: true },
      where: { type: 'REAL', user: { is: { isFake: false } } as any },
    }),
    // KPI: total BONUS credited to REAL accounts (all-time, non-fake)
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { type: 'BONUS', ...realNonFakeAccount },
    }),
    // KPI: total users CREATED in the dashboard's filter window. Every
    // other KPI on this page (deposits, withdrawals, wagered, etc.) is
    // already window-scoped — having totalUsers as the only "all-time"
    // metric was confusing (admin filters by "Hoje" and saw 35 = total
    // ever, not 0 = today's signups). Now matches the page semantics:
    // "tudo nesse card respeita o filtro de período acima".
    prisma.user.count({
      where: { role: 'USER', isFake: false, createdAt: { gte: from, lte: to } } as any,
    }),
    // KPI: new users today (always today, regardless of dashboard filter).
    // Distinct from totalUsers above — kept as a separate metric since
    // "novos hoje" is a daily-stand-up signal admins want at-a-glance.
    prisma.user.count({ where: { role: 'USER', isFake: false, createdAt: { gte: todayStart } } as any }),
    // KPI: total wagered in window — REAL + non-fake ops only
    prisma.operation.aggregate({
      _sum: { amount: true },
      where: { openedAt: { gte: from, lte: to }, ...realNonFakeAccount },
    }),
    // KPI: WON ops in window (we paid out the profit) — REAL + non-fake
    prisma.operation.aggregate({
      _sum:   { profit: true, amount: true },
      _count: true,
      where:  { status: 'WON', closedAt: { gte: from, lte: to }, ...realNonFakeAccount },
    }),
    // KPI: LOST ops in window (we kept the stake) — REAL + non-fake
    prisma.operation.aggregate({
      _sum:   { amount: true },
      _count: true,
      where:  { status: 'LOST', closedAt: { gte: from, lte: to }, ...realNonFakeAccount },
    }),
    // Chart: closed REAL + non-fake ops in last 7 days for the daily series
    prisma.operation.findMany({
      where: {
        status:   { in: ['WON', 'LOST'] },
        closedAt: { gte: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), lte: to },
        ...realNonFakeAccount,
      },
      select: { status: true, amount: true, profit: true, closedAt: true },
    }),
    // Lucrative users: ranking pelo "quanto o user tem a mais" do que
    // depositou.
    //
    // 2026-06-01: revisao do calculo (admin reclamou que estava inflado).
    //   Lucro Liquido = balance - SUM(DEPOSIT)
    // Bonus NAO entra na conta — bonus e' dinheiro da plataforma com
    // rollover pendente, nao lucro real do user. So' o balance principal
    // (sacavel) conta como "ganho de verdade".
    //
    // "Lucro Total" mantido como SUM(TRADE_WIN) pro admin ver o giro
    // bruto de wins (util pra ver quem opera muito vs. lucra muito).
    //
    // Fake users excluidos pra staged accounts nao aparecerem.
    prisma.$queryRaw<Array<{
      id:             string
      name:           string
      email:          string
      deposited:      any
      profit:         any
      net_profit:     any
      liquidity_mode: boolean
    }>>`
      SELECT
        u.id, u.name, u.email, u."liquidityMode" AS liquidity_mode,
        COALESCE(SUM(CASE WHEN t.type = 'DEPOSIT'::"TransactionType"   THEN t.amount END), 0) AS deposited,
        COALESCE(SUM(CASE WHEN t.type = 'TRADE_WIN'::"TransactionType" THEN t.amount END), 0) AS profit,
        COALESCE(MAX(a.balance), 0) -
        COALESCE(SUM(CASE WHEN t.type = 'DEPOSIT'::"TransactionType"   THEN t.amount END), 0) AS net_profit
      FROM users u
      LEFT JOIN accounts a     ON a."userId" = u.id AND a.type = 'REAL'::"AccountType"
      LEFT JOIN transactions t ON t."accountId" = a.id
      WHERE u.role = 'USER'::"UserRole" AND u."isFake" = false
      GROUP BY u.id, u.name, u.email, u."liquidityMode"
      HAVING
        COALESCE(MAX(a.balance), 0) -
        COALESCE(SUM(CASE WHEN t.type = 'DEPOSIT'::"TransactionType"   THEN t.amount END), 0) > 0
      ORDER BY net_profit DESC
      LIMIT 50
    `,
  ])

  const totalDeposits    = decimalToNumber(depAgg._sum.amount)
  const totalWithdrawals = Math.abs(decimalToNumber(wdAgg._sum.amount))
  const avgTicket        = decimalToNumber(depAgg._avg.amount)
  const userBalance      = decimalToNumber(balanceAgg._sum.balance)
  const userBonus        = decimalToNumber(bonusAgg._sum.amount)
  const totalWagered     = decimalToNumber(wageredAgg._sum.amount)
  const platformLoss     = decimalToNumber(wonOps._sum.profit)
  const platformProfit   = decimalToNumber(lostOps._sum.amount)

  // Build daily series for last 7 days.
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(to.getTime() - i * 24 * 60 * 60 * 1000)
    days.push(d.toISOString().slice(0, 10))
  }
  const dailyMap = new Map(days.map((d) => [d, { wins: 0, losses: 0 }]))
  for (const op of closedOpsWindow) {
    const day = op.closedAt!.toISOString().slice(0, 10)
    const bucket = dailyMap.get(day)
    if (!bucket) continue
    if (op.status === 'WON')  bucket.wins   += decimalToNumber(op.profit)
    if (op.status === 'LOST') bucket.losses += decimalToNumber(op.amount)
  }
  const last7days = days.map((d) => ({ date: d, ...dailyMap.get(d)! }))

  const lucrativeUsers: LucrativeUser[] = lucrativeRaw.map((r) => ({
    id:            r.id,
    name:          r.name,
    email:         r.email,
    deposited:     decimalToNumber(r.deposited),
    profit:        decimalToNumber(r.profit),
    netProfit:     decimalToNumber(r.net_profit),
    liquidityMode: !!r.liquidity_mode,
  }))

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      totalDeposits,
      totalWithdrawals,
      avgTicket,
      netFlow:              totalDeposits - totalWithdrawals,
      userBalance,
      userBonus,
      userBalancePlusBonus: userBalance + userBonus,
      totalUsers:           userCount,
      newUsersToday:        newUsersAgg,
      totalWagered,
      platformProfit,
      platformLoss,
      platformNetResult:    platformProfit - platformLoss,
    },
    charts: {
      distribution:    { wins: wonOps._count, losses: lostOps._count },
      last7days,
      operationCounts: { userWins: wonOps._count, userLosses: lostOps._count },
    },
    lucrativeUsers: lucrativeUsers.slice(0, 20),
    lucrativeCount: lucrativeUsers.length,
  }
}
