import bcrypt from 'bcryptjs'
import { prisma } from '../prisma.js'
import type { LoginInput, RegisterInput, UpdateProfileInput } from './schema.js'
import { verifyTotp } from './twoFactor.js'

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

  // Blocked accounts can't log in (existing sessions are NOT killed — they
  // expire naturally when the 15min access token does). Surface separately
  // from INVALID_CREDENTIALS so the UI can show a clear message.
  if ((user as any).blocked) {
    throw new Error('ACCOUNT_BLOCKED')
  }

  // Password OK. If 2FA is enabled, require + verify the code now.
  // Non-2FA users skip this branch entirely → existing behavior preserved.
  if (user.twoFactorEnabled) {
    if (!input.code) throw new Error('REQUIRES_2FA')
    const valid = user.twoFactorSecret && verifyTotp(user.twoFactorSecret, input.code)
    if (!valid) throw new Error('INVALID_2FA_CODE')
  }

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
  // Strip secrets that must never reach the client.
  const { password: _pw, twoFactorSecret: _2fa, ...safe } = user
  return {
    ...safe,
    // Dates come out of Prisma as Date — serialize to ISO so JSON works.
    birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
    accounts: (safe.accounts ?? []).map((a: any) => ({
      id:       a.id,
      type:     a.type,
      balance:  a.balance.toString(),
      currency: a.currency,
    })),
  }
}

export async function updateUserProfile(userId: string, input: UpdateProfileInput) {
  const data: any = {}
  if (input.name      !== undefined) data.name      = input.name
  if (input.nickname  !== undefined) data.nickname  = input.nickname  || null
  if (input.lastName  !== undefined) data.lastName  = input.lastName  || null
  if (input.birthDate !== undefined) data.birthDate = input.birthDate ? new Date(input.birthDate) : null
  if (input.cpf       !== undefined) data.cpf       = input.cpf       || null
  if (input.phone     !== undefined) data.phone     = input.phone     || null
  if (input.country   !== undefined) data.country   = input.country   || null
  if (input.address   !== undefined) data.address   = input.address   || null

  const user = await prisma.user.update({
    where:   { id: userId },
    data,
    include: { accounts: true },
  })
  return sanitizeUser(user)
}

