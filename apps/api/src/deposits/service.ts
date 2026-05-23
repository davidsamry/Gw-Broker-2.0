import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { createCashin, isConfigured } from '../payments/bspay.js'
import type { CreatePixDepositInput } from './schema.js'

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
export async function confirmDepositById(depositId: string) {
  const txDeposit = randomUUID()
  const txBonus   = randomUUID()
  const note      = 'Depósito confirmado pelo gateway (BSPay)'
  const bonusNote = 'Bônus de depósito confirmado pelo gateway (BSPay)'

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      target AS (
        SELECT id, "accountId", amount, COALESCE(bonus, 0) AS bonus
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
        SET balance = balance + (SELECT amount + bonus FROM target)
        WHERE id = (SELECT "accountId" FROM target)
        RETURNING id
      ),
      ins_dep_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${txDeposit}, "accountId", 'DEPOSIT'::"TransactionType", amount, ${note}, NOW()
        FROM target
        RETURNING id
      ),
      ins_bonus_tx AS (
        INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
        SELECT ${txBonus}, "accountId", 'BONUS'::"TransactionType", bonus, ${bonusNote}, NOW()
        FROM target WHERE bonus > 0
        RETURNING id
      )
    SELECT id FROM upd_dep
  `
  // rows empty == already PAID or doesn't exist (idempotent, swallowed).
  return rows.length > 0
}
