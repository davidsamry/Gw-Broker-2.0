import bcrypt from 'bcryptjs'
import { prisma } from '../prisma.js'
import type { LoginInput, RegisterInput } from './schema.js'

const DEMO_BALANCE = Number(process.env.DEMO_INITIAL_BALANCE ?? 10000)

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) throw new Error('EMAIL_TAKEN')

  const hash = await bcrypt.hash(input.password, 10)

  const user = await prisma.user.create({
    data: {
      name:     input.name,
      email:    input.email,
      password: hash,
      accounts: {
        create: [
          { type: 'DEMO', balance: DEMO_BALANCE, currency: 'BRL' },
          { type: 'REAL', balance: 0,            currency: 'BRL' },
        ],
      },
    },
    include: { accounts: true },
  })

  await prisma.transaction.create({
    data: {
      accountId:   user.accounts.find((a) => a.type === 'DEMO')!.id,
      type:        'DEMO_CREDIT',
      amount:      DEMO_BALANCE,
      description: 'Saldo inicial da conta demo',
    },
  })

  return sanitizeUser(user)
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where:   { email: input.email },
    include: { accounts: true },
  })
  if (!user) throw new Error('INVALID_CREDENTIALS')

  const ok = await bcrypt.compare(input.password, user.password)
  if (!ok) throw new Error('INVALID_CREDENTIALS')

  return sanitizeUser(user)
}

export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where:   { id: userId },
    include: { accounts: true },
  })
  if (!user) throw new Error('USER_NOT_FOUND')
  return sanitizeUser(user)
}

function sanitizeUser(user: any) {
  const { password: _pw, ...safe } = user
  return {
    ...safe,
    accounts: safe.accounts.map((a: any) => ({
      id:       a.id,
      type:     a.type,
      balance:  a.balance.toString(),
      currency: a.currency,
    })),
  }
}
