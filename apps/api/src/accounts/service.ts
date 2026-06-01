import { prisma } from '../prisma.js'

const DEMO_BALANCE = Number(process.env.DEMO_INITIAL_BALANCE ?? 10000)

export async function listAccounts(userId: string) {
  const accounts = await prisma.account.findMany({
    where:   { userId },
    orderBy: { type: 'asc' },
  })
  // IMPORTANTE: payload tem que bater com o que /auth/me sanitizeUser
  // retorna. Quando o frontend chama refreshAccounts() apos um SSE de
  // trade, ele faz set({user: {...user, accounts: data.accounts}}) — se
  // este endpoint NAO incluir bonusBalance/rollover*, esses campos somem
  // do user.accounts e o display zera o saldo do bonus. Bug visivel:
  // "saldo todo zera ao clicar em operar" — investigado 2026-05-31.
  return accounts.map((a) => ({
    id:               a.id,
    type:             a.type,
    balance:          a.balance.toString(),
    currency:         a.currency,
    bonusBalance:     a.bonusBalance.toString(),
    rolloverRequired: a.rolloverRequired.toString(),
    rolloverProgress: a.rolloverProgress.toString(),
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
