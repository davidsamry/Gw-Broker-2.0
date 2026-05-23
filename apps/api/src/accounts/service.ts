import { prisma } from '../prisma.js'

const DEMO_BALANCE = Number(process.env.DEMO_INITIAL_BALANCE ?? 10000)

export async function listAccounts(userId: string) {
  const accounts = await prisma.account.findMany({
    where:   { userId },
    orderBy: { type: 'asc' },
  })
  return accounts.map((a) => ({
    id:       a.id,
    type:     a.type,
    balance:  a.balance.toString(),
    currency: a.currency,
  }))
}

export async function resetDemoAccount(userId: string) {
  const demo = await prisma.account.findUnique({
    where: { userId_type: { userId, type: 'DEMO' } },
  })
  if (!demo) throw new Error('DEMO_ACCOUNT_NOT_FOUND')

  await prisma.$transaction([
    prisma.operation.updateMany({
      where: { accountId: demo.id, status: 'OPEN' },
      data:  { status: 'CANCELLED', closedAt: new Date() },
    }),
    prisma.account.update({
      where: { id: demo.id },
      data:  { balance: DEMO_BALANCE },
    }),
    prisma.transaction.create({
      data: {
        accountId:   demo.id,
        type:        'DEMO_CREDIT',
        amount:      DEMO_BALANCE,
        description: 'Conta demo zerada',
      },
    }),
  ])

  return { ok: true, balance: DEMO_BALANCE.toString() }
}
