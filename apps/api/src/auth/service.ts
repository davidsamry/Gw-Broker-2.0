import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { prisma } from '../prisma.js'
import type { LoginInput, RegisterInput, UpdateProfileInput, KycSubmitInput, ChangePasswordInput } from './schema.js'
import { verifyTotp } from './twoFactor.js'
import { sendEmailAsync } from '../email/service.js'

const DEMO_BALANCE = Number(process.env.DEMO_INITIAL_BALANCE ?? 10000)

export async function registerUser(input: RegisterInput, requestMeta?: {
  ip?:        string | null
  userAgent?: string | null
}) {
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
      lastName: input.lastName || null,
      phone:    input.phone   || null,
      country:  input.country || null,
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
    // Envia o máximo de identidade disponível no cadastro (email, nome,
    // external_id). phone/country/lastName geralmente ainda nulos aqui —
    // são omitidos automaticamente e chegam nos webhooks de depósito.
    sendRegistrationWebhook({
      id:        user.id,
      email:     user.email,
      name:      user.name,
      lastName:  (user as any).lastName ?? null,
      phone:     (user as any).phone ?? null,
      country:   (user as any).country ?? null,
      // Sinais de navegador/clique (Meta CAPI): fbp/fbc dos cookies enviados
      // pelo client, ip/userAgent do request. Melhoram muito o matching.
      fbp:       input.tracking?.fbp ?? null,
      fbc:       input.tracking?.fbc ?? null,
      ip:        requestMeta?.ip ?? null,
      userAgent: requestMeta?.userAgent ?? null,
    })
  }).catch(() => { /* dynamic import only fails on bundler weirdness */ })

  // Meta Conversions API — save attribution + fire CompleteRegistration.
  // Both fire-and-forget. Attribution save MUST happen before the event
  // fires so the event includes fbp/fbc; we await it briefly (sub-ms in
  // practice — single UPSERT) and then dispatch the event. Failure on
  // either side is logged, never thrown.
  void (async () => {
    try {
      const { saveUserTracking } = await import('../meta/tracking.js')
      await saveUserTracking(user.id, {
        ...(input.tracking ?? {}),
        ip:        requestMeta?.ip        ?? null,
        userAgent: requestMeta?.userAgent ?? null,
      })
    } catch (err) {
      console.error('[meta] saveUserTracking failed (non-fatal)', err)
    }
    try {
      const { sendCompleteRegistrationAsync } = await import('../meta/service.js')
      sendCompleteRegistrationAsync({ id: user.id, email: user.email })
    } catch (err) {
      console.error('[meta] CompleteRegistration enqueue failed (non-fatal)', err)
    }
  })()

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

  // 2026-06-01: Login normal (trader) NAO exige mais 2FA, mesmo pra admins.
  // Admins precisam fazer step-up (POST /auth/admin-step-up) com o code 2FA
  // pra obter um token marcado com adminAuth=true antes de acessar /admin/*.
  // O requireAdmin decorator agora exige essa claim. Tokens antigos sem ela
  // sao tratados como "trader mode" e bloqueados em rotas admin.
  //
  // Users normais com 2FA habilitado: comportamento mantido (exige code).
  // So admins ganharam o "skip" — o 2FA deles agora protege ESPECIFICAMENTE
  // o painel admin, nao o login da plataforma.
  if (user.twoFactorEnabled && user.role !== 'ADMIN') {
    if (!input.code) throw new Error('REQUIRES_2FA')
    const valid = user.twoFactorSecret && verifyTotp(user.twoFactorSecret, input.code)
    if (!valid) throw new Error('INVALID_2FA_CODE')
  }

  return sanitizeUser(user)
}

/**
 * Registra/atualiza o IP de acesso de um login bem-sucedido. Atômico via
 * ON CONFLICT: 1 linha por (userId, ip) — incrementa o count, atualiza o
 * lastSeenAt e guarda o userAgent mais recente. Mantém a tabela pequena
 * (1 row por IP distinto) — é o que o painel admin exibe.
 *
 * Best-effort: o caller DEVE chamar fire-and-forget (void + catch). Uma
 * falha aqui NUNCA pode impedir o login.
 */
export async function recordLoginHistory(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  const ip = (meta.ip ?? 'unknown').slice(0, 100)
  const ua = meta.userAgent ? meta.userAgent.slice(0, 400) : null
  await prisma.$executeRaw`
    INSERT INTO login_history ("id", "userId", "ip", "userAgent", "count", "firstSeenAt", "lastSeenAt")
    VALUES (${randomUUID()}, ${userId}, ${ip}, ${ua}, 1, NOW(), NOW())
    ON CONFLICT ("userId", "ip")
    DO UPDATE SET "lastSeenAt" = NOW(),
                  "count"      = login_history."count" + 1,
                  "userAgent"  = EXCLUDED."userAgent"
  `
}

/**
 * Step-up authentication pro admin. Chamado depois do login normal:
 * recebe o code 2FA e, se valido, retorna o "marker" pro caller (route
 * handler) usar quando re-emitir o JWT com claim adminAuth=true.
 *
 * Throws:
 *   NOT_ADMIN          — user nao tem role=ADMIN
 *   TWO_FACTOR_NOT_ENABLED — admin sem 2FA configurado (deveria nao
 *                            existir; AdminGuard manda pra setup-2fa)
 *   INVALID_2FA_CODE   — code rejeitado pelo verifyTotp
 */
export async function verifyAdminStepUp(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { role: true, twoFactorEnabled: true, twoFactorSecret: true },
  })
  if (!user || user.role !== 'ADMIN') throw new Error('NOT_ADMIN')
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new Error('TWO_FACTOR_NOT_ENABLED')
  }
  if (!verifyTotp(user.twoFactorSecret, code)) {
    throw new Error('INVALID_2FA_CODE')
  }
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
      // Bonus + rollover incluidos pra:
      //  - dropdown da conta mostrar "+R$ X bonus"
      //  - modal de Retirada calcular "faltam R$ Y de rollover"
      //  - MinhaContaTab exibir saldo de bonus separado
      // Sem esses 3, o frontend caia em fallback 0 silencioso.
      bonusBalance:     a.bonusBalance?.toString()     ?? '0',
      rolloverRequired: a.rolloverRequired?.toString() ?? '0',
      rolloverProgress: a.rolloverProgress?.toString() ?? '0',
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
  if (input.city      !== undefined) data.city      = input.city      || null
  if (input.state     !== undefined) data.state     = input.state     || null
  if (input.zip       !== undefined) data.zip       = input.zip       || null

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

