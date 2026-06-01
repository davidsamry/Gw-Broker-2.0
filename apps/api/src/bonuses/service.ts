// User-facing bonus operations (Fase B1):
//   • validateCodeForUser  — pre-checkout check used by the deposit modal
//   • attachToDeposit      — called by createPixDeposit when a code is supplied
//   • activateForPaidDeposit — flips the grant from PENDING → ACTIVE and
//                              credits the bonus to the user's account.
//                              Called by the BSPay webhook + admin mark-paid.
//
// Constraint enforced everywhere: at most ONE pending|active grant per user.

import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'

export interface ValidatedBonus {
  id:         string
  code:       string
  type:       'PERCENTAGE' | 'FIXED'
  value:      number
  minDeposit: number
  rollover:   number
  // Preview of what the user would receive for the provided depositAmount.
  bonusAmount:      number
  rolloverRequired: number
}

export type ValidateError =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'BELOW_MIN'
  | 'USER_HAS_OPEN_GRANT'
  | 'USER_MAX_USES_REACHED'

/**
 * Verify a code for a given user + deposit amount. Returns the bonus
 * preview if valid, otherwise an error code the frontend can translate.
 */
export async function validateCodeForUser(
  userId:        string,
  code:          string,
  depositAmount: number,
): Promise<{ ok: true; bonus: ValidatedBonus } | { ok: false; error: ValidateError }> {
  const bonus = await prisma.bonus.findUnique({
    where: { code: code.toUpperCase().trim() },
  })
  if (!bonus)         return { ok: false, error: 'NOT_FOUND' }
  if (!bonus.active)  return { ok: false, error: 'INACTIVE' }
  if (bonus.expiresAt && bonus.expiresAt < new Date()) return { ok: false, error: 'EXPIRED' }
  if (Number(bonus.minDeposit) > depositAmount)        return { ok: false, error: 'BELOW_MIN' }

  // 2026-05-31: Removida a regra "1 grant aberto por user". Agora o user
  // pode ter multiplos bonus PENDING/ACTIVE simultaneos — cada deposito
  // confirmado credita seu proprio bonus. O rollover continua agregado
  // na conta (Account.rolloverRequired soma TODOS os bonus + a regra
  // do depositRollover). maxUsesPerUser abaixo ainda limita o numero
  // de redempts do MESMO codigo.

  // Per-user usage cap (counts completed + cancelled too — the limit is
  // about lifetime redemptions of this specific code).
  const priorUses = await prisma.bonusGrant.count({
    where: { userId, bonusId: bonus.id },
  })
  if (priorUses >= bonus.maxUsesPerUser) {
    return { ok: false, error: 'USER_MAX_USES_REACHED' }
  }

  const bonusAmount = bonus.type === 'PERCENTAGE'
    ? Math.round((depositAmount * Number(bonus.value)) / 100 * 100) / 100
    : Number(bonus.value)
  const rolloverRequired = Math.round(bonusAmount * bonus.rollover * 100) / 100

  return {
    ok:    true,
    bonus: {
      id:         bonus.id,
      code:       bonus.code,
      type:       bonus.type,
      value:      Number(bonus.value),
      minDeposit: Number(bonus.minDeposit),
      rollover:   bonus.rollover,
      bonusAmount,
      rolloverRequired,
    },
  }
}

/**
 * Create a PENDING grant tied to a freshly-created deposit. Called from
 * the deposit creation flow when the user supplied a bonus code that
 * validateCodeForUser accepted. The grant flips to ACTIVE when the
 * deposit becomes PAID (see activateForPaidDeposit).
 */
export async function createPendingGrantForDeposit(args: {
  userId:        string
  bonusId:       string
  depositId:     string
  bonusAmount:   number
  rollover:      number
}) {
  return prisma.bonusGrant.create({
    data: {
      userId:           args.userId,
      bonusId:          args.bonusId,
      depositId:        args.depositId,
      bonusAmount:      new Prisma.Decimal(args.bonusAmount),
      rolloverRequired: new Prisma.Decimal(args.bonusAmount * args.rollover),
      rolloverProgress: new Prisma.Decimal(0),
      status:           'PENDING',
    },
  })
}

/**
 * When a deposit becomes PAID, flip any associated PENDING grant to
 * ACTIVE and credit the bonus amount to the user's real account.
 * Idempotent — a second call with the same depositId is a no-op.
 *
 * Returns the credited bonus amount (0 if no grant or already active).
 */
export async function activateForPaidDeposit(depositId: string): Promise<number> {
  const grant = await prisma.bonusGrant.findFirst({
    where: { depositId, status: 'PENDING' },
  })
  if (!grant) return 0

  // Find the deposit's account so we know where to credit.
  const deposit = await prisma.deposit.findUnique({
    where:  { id: depositId },
    select: { accountId: true, account: { select: { userId: true } } },
  })
  if (!deposit) return 0

  const bonusAmount      = Number(grant.bonusAmount)
  const bonusRollover    = Number(grant.rolloverRequired)  // = bonusAmount * bonus.rollover (pre-calc no createPendingGrantForDeposit)

  // Transaction atomica:
  //   1. Credita o bonus em bonusBalance (NAO no balance principal — saldo
  //      sacavel ate' completar rollover continua sendo so' o balance).
  //   2. Soma o rollover do bonus (bonusAmount * bonus.rollover) no
  //      Account.rolloverRequired. Saque so' libera quando rolloverProgress
  //      >= esse total acumulado.
  //   3. Marca o grant como ACTIVE.
  //   4. Audit transaction tipo BONUS pro extrato.
  //
  // Bug-fix 2026-05-31: antes creditava bonus no balance e NAO somava
  // rolloverRequired. Resultado: user sacava o bonus sem fazer rollover
  // real do codigo — efetivamente "free money".
  await prisma.$transaction([
    prisma.account.update({
      where: { id: deposit.accountId },
      data:  {
        bonusBalance:     { increment: bonusAmount },
        rolloverRequired: { increment: bonusRollover },
      },
    }),
    prisma.transaction.create({
      data: {
        accountId:   deposit.accountId,
        type:        'BONUS',
        amount:      new Prisma.Decimal(bonusAmount),
        description: `Bônus aplicado (grant=${grant.id}, rollover +R$ ${bonusRollover.toFixed(2)})`,
      },
    }),
    prisma.bonusGrant.update({
      where: { id: grant.id },
      data:  { status: 'ACTIVE' },
    }),
  ])

  return bonusAmount
}

// Get the user's current open (PENDING|ACTIVE) grant if any. Surfaced
// via /auth/me hydration so the frontend can show rollover progress.
export async function getUserOpenGrant(userId: string) {
  return prisma.bonusGrant.findFirst({
    where: { userId, status: { in: ['PENDING', 'ACTIVE'] } },
    include: { bonus: { select: { code: true } } },
  })
}

// Active, non-expired bonus codes the user can pick from in the deposit
// modal dropdown. Filters out codes the user already maxed out OR has an
// open grant for (those would fail validation anyway — better not to
// offer them). Returns minimal fields so the dropdown stays light.
export interface AvailableBonus {
  id:         string
  code:       string
  type:       'PERCENTAGE' | 'FIXED'
  value:      number      // % for PERCENTAGE, R$ for FIXED
  minDeposit: number
  rollover:   number
}

export async function listAvailableBonusesForUser(userId: string): Promise<AvailableBonus[]> {
  // 2026-05-31: Removida tb a "early return" se houvesse grant aberto.
  // O dropdown lista os codigos disponiveis independente de grants
  // anteriores — user pode acumular multiplos bonus simultaneos.

  // Aggregate usage per code so we can filter out user-exhausted codes
  // in the same round-trip.
  const rows = await prisma.$queryRaw<Array<{
    id: string; code: string; type: 'PERCENTAGE' | 'FIXED';
    value: string; minDeposit: string; rollover: number;
  }>>`
    SELECT b.id, b.code, b.type::text AS type,
           b.value::text AS value,
           b."minDeposit"::text AS "minDeposit",
           b.rollover
    FROM bonuses b
    LEFT JOIN bonus_grants g
      ON g."bonusId" = b.id AND g."userId" = ${userId}
    WHERE b.active = TRUE
      AND (b."expiresAt" IS NULL OR b."expiresAt" > NOW())
    GROUP BY b.id
    HAVING COUNT(g.id) < b."maxUsesPerUser"
    ORDER BY b."minDeposit" ASC, b."createdAt" DESC
  `
  return rows.map(r => ({
    id:         r.id,
    code:       r.code,
    type:       r.type,
    value:      Number(r.value),
    minDeposit: Number(r.minDeposit),
    rollover:   r.rollover,
  }))
}
