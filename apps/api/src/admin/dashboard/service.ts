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
    // KPI: total deposits in window
    prisma.transaction.aggregate({
      _sum:  { amount: true },
      _avg:  { amount: true },
      _count: true,
      where: { type: 'DEPOSIT', createdAt: { gte: from, lte: to } },
    }),
    // KPI: total withdrawals in window (sum of -amount → flip sign)
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { type: 'WITHDRAWAL', createdAt: { gte: from, lte: to } },
    }),
    // KPI: total REAL balance (all-time)
    prisma.account.aggregate({
      _sum: { balance: true },
      where: { type: 'REAL' },
    }),
    // KPI: total BONUS credited (all-time, positive entries)
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { type: 'BONUS' },
    }),
    // KPI: total users (all-time)
    prisma.user.count({ where: { role: 'USER' } }),
    // KPI: new users today
    prisma.user.count({ where: { role: 'USER', createdAt: { gte: todayStart } } }),
    // KPI: total wagered in window
    prisma.operation.aggregate({
      _sum: { amount: true },
      where: { openedAt: { gte: from, lte: to } },
    }),
    // KPI: WON ops in window (we paid out the profit)
    prisma.operation.aggregate({
      _sum:   { profit: true, amount: true },
      _count: true,
      where:  { status: 'WON', closedAt: { gte: from, lte: to } },
    }),
    // KPI: LOST ops in window (we kept the stake)
    prisma.operation.aggregate({
      _sum:   { amount: true },
      _count: true,
      where:  { status: 'LOST', closedAt: { gte: from, lte: to } },
    }),
    // Chart: closed ops in last 7 days for the daily series
    prisma.operation.findMany({
      where: {
        status:   { in: ['WON', 'LOST'] },
        closedAt: { gte: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), lte: to },
      },
      select: { status: true, amount: true, profit: true, closedAt: true },
    }),
    // Lucrative users: SUM deposits vs SUM profits per user. Returns users
    // whose net (profit - deposited) is positive.
    prisma.$queryRaw<Array<{
      id:         string
      name:       string
      email:      string
      deposited:  any
      profit:     any
      net_profit: any
    }>>`
      SELECT
        u.id, u.name, u.email,
        COALESCE(SUM(CASE WHEN t.type = 'DEPOSIT'::"TransactionType"   THEN t.amount END), 0) AS deposited,
        COALESCE(SUM(CASE WHEN t.type = 'TRADE_WIN'::"TransactionType" THEN t.amount END), 0) AS profit,
        COALESCE(SUM(CASE WHEN t.type = 'TRADE_WIN'::"TransactionType" THEN t.amount END), 0) -
        COALESCE(SUM(CASE WHEN t.type = 'DEPOSIT'::"TransactionType"   THEN t.amount END), 0) AS net_profit
      FROM users u
      LEFT JOIN accounts a     ON a."userId" = u.id AND a.type = 'REAL'::"AccountType"
      LEFT JOIN transactions t ON t."accountId" = a.id
      WHERE u.role = 'USER'::"UserRole"
      GROUP BY u.id, u.name, u.email
      HAVING
        COALESCE(SUM(CASE WHEN t.type = 'TRADE_WIN'::"TransactionType" THEN t.amount END), 0) -
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
    id:        r.id,
    name:      r.name,
    email:     r.email,
    deposited: decimalToNumber(r.deposited),
    profit:    decimalToNumber(r.profit),
    netProfit: decimalToNumber(r.net_profit),
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
