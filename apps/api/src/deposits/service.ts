import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { createCashin, isConfigured } from '../payments/bspay.js'
import type { CreatePixDepositInput } from './schema.js'
import {
  validateCodeForUser, createPendingGrantForDeposit, activateForPaidDeposit,
} from '../bonuses/service.js'

export interface CreatedDeposit {
  id:         string
  amount:     string
  status:     string
  qrcode:     string  // BR-Code text to render as QR and/or paste-and-pay
  createdAt:  Date
}

// Compose the public-facing postback URL the gateway calls when the user pays.
// API_PUBLIC_URL must point to the API host (e.g. https://api.vx-global.com).
// BSPAY_WEBHOOK_SECRET is a random string we put into the URL path — anyone
// who reaches /webhooks/bspay/<secret> without knowing it gets 404'd.
function buildPostbackUrl(): string {
  const base   = (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
  const secret = process.env.BSPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('BSPAY_WEBHOOK_SECRET_MISSING')
  return `${base}/webhooks/bspay/${secret}`
}

// Create a PIX deposit: insert a PENDING Deposit row, ask the gateway for
// a QR code, persist the gateway's transaction id for reconciliation.
// The user's balance is NOT credited here — it's credited by the webhook
// when the gateway confirms payment.
export async function createPixDeposit(userId: string, input: CreatePixDepositInput): Promise<CreatedDeposit> {
  if (!isConfigured()) throw new Error('BSPAY_NOT_CONFIGURED')

  // Find the user's REAL account (one per user by unique constraint).
  const accountRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM accounts
    WHERE "userId" = ${userId} AND type = 'REAL'::"AccountType"
    LIMIT 1
  `
  if (accountRows.length === 0) throw new Error('REAL_ACCOUNT_NOT_FOUND')
  const accountId = accountRows[0].id

  const depositId  = randomUUID()
  const amountDec  = new Prisma.Decimal(input.amount)

  // Fase B1: optional bonus code. Validated BEFORE inserting the deposit
  // row so the user gets an immediate error if the code's bad. The grant
  // is created in PENDING state right after the deposit insert; it flips
  // to ACTIVE only when the deposit confirms (PAID).
  let validatedBonus: Awaited<ReturnType<typeof validateCodeForUser>> | null = null
  if (input.bonusCode) {
    validatedBonus = await validateCodeForUser(userId, input.bonusCode, input.amount)
    if (!validatedBonus.ok) {
      throw new Error(`BONUS_${validatedBonus.error}`)
    }
  }

  // Insert the deposit row first — gives us a stable id to use as external_id
  // with the gateway. If the gateway call below fails, we leave the PENDING
  // row in place (won't credit the user — only the webhook can do that).
  await prisma.$executeRaw`
    INSERT INTO deposits (id, "accountId", amount, method, status, "createdAt", "updatedAt")
    VALUES (
      ${depositId}, ${accountId}, ${amountDec},
      'PIX'::"DepositMethod", 'PENDING'::"DepositStatus", NOW(), NOW()
    )
  `

  // Create the grant after the deposit row exists (FK is depositId, not strict
  // but we use it for traceability + the activate flow looks it up by depositId).
  if (validatedBonus?.ok) {
    try {
      await createPendingGrantForDeposit({
        userId,
        bonusId:     validatedBonus.bonus.id,
        depositId,
        bonusAmount: validatedBonus.bonus.bonusAmount,
        rollover:    validatedBonus.bonus.rollover,
      })
    } catch (err) {
      // If the grant insert fails (e.g., race: user opened a different
      // bonus tab), leave the deposit alive so the user can still pay,
      // but log loudly. They just won't get the bonus.
      console.error('[deposits] grant insert failed — deposit will proceed without bonus', err)
    }
  }

  // Call BSPay. On failure, mark the deposit FAILED + bubble the error
  // so the user sees something actionable.
  let qrcode:     string
  let providerId: string | null
  try {
    const cashin = await createCashin({
      amount:      input.amount,
      externalId:  depositId,
      postbackUrl: buildPostbackUrl(),
    })
    qrcode     = cashin.qrcode
    providerId = cashin.providerId
  } catch (err: any) {
    await prisma.$executeRaw`
      UPDATE deposits SET status = 'FAILED'::"DepositStatus", "updatedAt" = NOW()
      WHERE id = ${depositId}
    `
    throw err
  }

  // Store the gateway's id so the webhook can reconcile, and as audit trail.
  await prisma.$executeRaw`
    UPDATE deposits SET "externalId" = ${providerId}, "updatedAt" = NOW()
    WHERE id = ${depositId}
  `

  return {
    id:        depositId,
    amount:    amountDec.toString(),
    status:    'PENDING',
    qrcode,
    createdAt: new Date(),
  }
}

// Lightweight status check the frontend polls every few seconds while the
// QR is on screen. Only exposes fields the user needs.
export async function getMyDepositStatus(userId: string, depositId: string) {
  const rows = await prisma.$queryRaw<Array<{
    id:        string
    amount:    any
    status:    string
    createdAt: Date
    paidAt:    Date | null
  }>>`
    SELECT d.id, d.amount, d.status::text AS status, d."createdAt", d."paidAt"
    FROM deposits d
    INNER JOIN accounts a ON a.id = d."accountId"
    WHERE d.id = ${depositId} AND a."userId" = ${userId}
    LIMIT 1
  `
  const r = rows[0]
  if (!r) throw new Error('DEPOSIT_NOT_FOUND')
  return { ...r, amount: r.amount.toString() }
}

// Webhook entry point. Idempotent: if the deposit is already PAID we return
// without re-crediting the user.
//
// Fase B1: bonus credit moved to activateForPaidDeposit (called below)
// instead of the legacy `deposits.bonus` column path. Keeps the CTE
// simple — just credit the deposit amount, write the DEPOSIT tx, flip
// status. Bonus credit happens in its own step after.
export async function confirmDepositById(depositId: string) {
  const txDeposit = randomUUID()
  const note      = 'Depósito confirmado pelo gateway (BSPay)'

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      target AS (
        SELECT id, "accountId", amount
        FROM deposits
        WHERE id = ${depositId}
          AND status = 'PENDING'::"DepositStatus"
      ),
      upd_dep AS (
        UPDATE deposits
        SET status = 'PAID'::"DepositStatus", "paidAt" = NOW(), "updatedAt" = NOW()
        WHERE id IN (SELECT id FROM target)
        RETURNING id
      ),
      upd_bal AS (
        UPDATE accounts
        SET balance = balance + (SELECT amount FROM target)
        WHERE id = (SELECT "accountId" FROM target)
        RETURNING id
      ),
      ins_dep_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${txDeposit}, "accountId", 'DEPOSIT'::"TransactionType", amount, ${note}, NOW()
        FROM target
        RETURNING id
      )
    SELECT id FROM upd_dep
  `
  const wasPending = rows.length > 0
  if (!wasPending) return false   // already PAID or doesn't exist — idempotent

  // Fase B1: if a BonusGrant is tied to this deposit, activate it now.
  // Errors here don't roll back the deposit — the user has already paid,
  // they shouldn't be punished for our bonus accounting; we just log.
  try {
    const credited = await activateForPaidDeposit(depositId)
    if (credited > 0) {
      console.log(`[deposits] bonus credited deposit=${depositId} amount=${credited}`)
    }
  } catch (err) {
    console.error(`[deposits] activateForPaidDeposit failed for deposit=${depositId}`, err)
  }

  return true
}
