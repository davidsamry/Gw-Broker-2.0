import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { prisma } from '../prisma.js'
import type { LoginInput, RegisterInput, UpdateProfileInput, KycSubmitInput, ChangePasswordInput } from './schema.js'
import { verifyTotp } from './twoFactor.js'
import { sendEmailAsync } from '../email/service.js'

const DEMO_BALANCE = Number(process.env.DEMO_INITIAL_BALANCE ?? 10000)

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) throw new Error('EMAIL_TAKEN')

  // CPF uniqueness — soft check (no DB constraint yet so we don't block on
  // a migration). One person = one account. The schema validated the CPF
  // checksum already, so input.cpf is 11 raw digits.
  const cpfTaken = await prisma.user.findFirst({ where: { cpf: input.cpf } })
  if (cpfTaken) throw new Error('CPF_TAKEN')

  const hash = await bcrypt.hash(input.password, 10)

  const user = await prisma.user.create({
    data: {
      name:     input.name,
      email:    input.email,
      password: hash,
      cpf:      input.cpf,
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

  // Fire-and-forget welcome email. Failure (provider down, template
  // disabled) logs to stderr but never blocks the registration flow.
  sendEmailAsync({
    templateKey: 'WELCOME',
    to:          user.email,
    vars:        { name: user.name },
  })

  // Fire-and-forget outbound webhook (TrackFlow integration). Admin
  // toggles + URL configurable via /admin/webhooks. Like the email above,
  // never blocks the registration flow — service swallows all errors.
  void import('../webhooks/service.js').then(({ sendRegistrationWebhook }) => {
    sendRegistrationWebhook(user.email)
  }).catch(() => { /* dynamic import only fails on bundler weirdness */ })

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

// KYC: returns the user's submission (if any) — used by /auth/me hydrate so
// the Conta tab knows whether to show "Enviar documentos" or the pending
// banner.
export async function getKycSubmission(userId: string) {
  const rows = await prisma.$queryRaw<Array<{
    id: string
    status: string
    reason: string | null
    submittedAt: Date
    reviewedAt: Date | null
  }>>`
    SELECT id, status::text AS status, reason, "submittedAt", "reviewedAt"
    FROM kyc_submissions
    WHERE "userId" = ${userId}
    LIMIT 1
  `
  return rows[0] ?? null
}

// User-initiated KYC submission. Inserts or replaces (one submission per
// user) and bumps User.kycStatus to SUBMITTED so the admin queue picks it up.
export async function submitKyc(userId: string, input: KycSubmitInput) {
  const id = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO kyc_submissions
        (id, "userId", "documentFrontUrl", "documentBackUrl", "selfieUrl", status, "submittedAt")
      VALUES
        (${id}, ${userId}, ${input.documentFrontUrl}, ${input.documentBackUrl}, ${input.selfieUrl},
         'SUBMITTED'::"KycStatus", NOW())
      ON CONFLICT ("userId") DO UPDATE SET
        "documentFrontUrl" = EXCLUDED."documentFrontUrl",
        "documentBackUrl"  = EXCLUDED."documentBackUrl",
        "selfieUrl"        = EXCLUDED."selfieUrl",
        status             = 'SUBMITTED'::"KycStatus",
        reason             = NULL,
        "submittedAt"      = NOW(),
        "reviewedAt"       = NULL,
        "reviewedBy"       = NULL
    `
    await tx.$executeRaw`
      UPDATE users SET "kycStatus" = 'SUBMITTED'::"KycStatus" WHERE id = ${userId}
    `
  })
  return getKycSubmission(userId)
}

// Authenticated password change. Verifies `currentPassword` against the
// stored hash before writing the new one. Throws specific error codes so
// the route handler can map to friendly HTTP statuses + frontend messages.
//   - INVALID_CURRENT_PASSWORD → 401 (wrong current pw)
//   - SAME_PASSWORD            → 400 (new == old; prevents accidental no-op)
//   - USER_NOT_FOUND           → 404
export async function changeUserPassword(userId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { password: true },
  })
  if (!user) throw new Error('USER_NOT_FOUND')

  const ok = await bcrypt.compare(input.currentPassword, user.password)
  if (!ok) throw new Error('INVALID_CURRENT_PASSWORD')

  // Block trivially-identical update so the user gets explicit feedback
  // instead of a silent success that doesn't actually change anything.
  const same = await bcrypt.compare(input.newPassword, user.password)
  if (same) throw new Error('SAME_PASSWORD')

  const hash = await bcrypt.hash(input.newPassword, 10)
  await prisma.user.update({
    where: { id: userId },
    data:  { password: hash },
  })
}

export async function updateUserProfile(userId: string, input: UpdateProfileInput) {
  const data: any = {}
  if (input.name      !== undefined) data.name      = input.name
  if (input.email     !== undefined) data.email     = input.email
  if (input.nickname  !== undefined) data.nickname  = input.nickname  || null
  if (input.lastName  !== undefined) data.lastName  = input.lastName  || null
  if (input.birthDate !== undefined) data.birthDate = input.birthDate ? new Date(input.birthDate) : null
  if (input.cpf       !== undefined) data.cpf       = input.cpf       || null
  if (input.phone     !== undefined) data.phone     = input.phone     || null
  if (input.country   !== undefined) data.country   = input.country   || null
  if (input.address   !== undefined) data.address   = input.address   || null

  try {
    const user = await prisma.user.update({
      where:   { id: userId },
      data,
      include: { accounts: true },
    })
    return sanitizeUser(user)
  } catch (err: any) {
    // Unique constraint violation on email — surface a clean error code.
    if (err?.code === 'P2002' && err?.meta?.target?.includes?.('email')) {
      throw new Error('EMAIL_TAKEN')
    }
    throw err
  }
}

