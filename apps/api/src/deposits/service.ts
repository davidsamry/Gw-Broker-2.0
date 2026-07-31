import { randomUUID } from 'node:crypto'
import { sendEmailAsync } from '../email/service.js'
import { getSettings } from '../settings/service.js'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { createCashin, createCryptoCashin, getBrlToUsdtRate, isConfigured } from '../payments/bspay.js'
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

  // Find the user's REAL account + display name (BSPay shows the payer
  // name on the bank app side).
  const accountRows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT a.id, u.name
    FROM accounts a
    INNER JOIN users u ON u.id = a."userId"
    WHERE a."userId" = ${userId} AND a.type = 'REAL'::"AccountType"
    LIMIT 1
  `
  if (accountRows.length === 0) throw new Error('REAL_ACCOUNT_NOT_FOUND')
  const accountId  = accountRows[0].id
  const payerName  = accountRows[0].name

  // ── Auto-cancel PIX/bonus PENDING orfaos do MESMO PIX abandonado ────
  // Quando user gera NOVO PIX, assume-se que abandonou o anterior. Limpa:
  //   - deposits PENDING desta conta REAL (sao "PIX QR ativos" — so' faz
  //     sentido ter 1 por vez)
  //   - bonus_grants PENDING ligados a esses deposits (cascade — sem o
  //     deposit pago, o grant nunca seria ativado)
  //
  // NAO cancela grants ACTIVE (ja' creditados) nem grants PENDING ligados
  // a OUTROS deposits — o user pode ter multiplos bonus simultaneos agora
  // (regra "1 grant aberto" foi removida em 2026-05-31).
  //
  // Race condition (raro): se user pagar o PIX antigo entre este cancel
  // e o webhook chegar, confirmDepositById detecta status CANCELLED e
  // reativa pra PAID + credita saldo. O bonus_grant cancelado em cascade
  // NAO e' reativado — user perde o bonus do PIX antigo mas recebe o
  // saldo do deposito. Caso degenerate.
  await prisma.$transaction([
    // Primeiro: cancela grants PENDING ligados aos deposits PENDING desta conta
    prisma.$executeRaw`
      UPDATE bonus_grants
      SET status = 'CANCELLED'::"BonusGrantStatus", "cancelledAt" = NOW()
      WHERE status = 'PENDING'::"BonusGrantStatus"
        AND "depositId" IN (
          SELECT id FROM deposits
          WHERE "accountId" = ${accountId}
            AND status = 'PENDING'::"DepositStatus"
        )
    `,
    // Depois: cancela os deposits PENDING em si
    prisma.$executeRaw`
      UPDATE deposits
      SET status = 'CANCELLED'::"DepositStatus", "updatedAt" = NOW(),
          notes = COALESCE(notes, '') || ' [auto-cancelado: novo PIX gerado]'
      WHERE "accountId" = ${accountId} AND status = 'PENDING'::"DepositStatus"
    `,
  ])

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
      amount:        input.amount,
      externalId:    depositId,
      postbackUrl:   buildPostbackUrl(),
      payerDocument: input.cpf,
      payerName,
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

// ── Depósito USDT TRC20 via BSPay crypto cashin ─────────────────────────
// User digita R$ X → cotamos USDT (USDTBRL spot Binance) → criamos cobranca
// na BSPay com currency=USDT, chain=tron, amount=USDT calculado. BSPay
// retorna um endereco de wallet — frontend mostra + QR code do address.
// User envia EXATAMENTE Y USDT pra esse endereco. BSPay detecta on-chain
// e dispara webhook cashin.confirmed com tx_hash.
//
// O saldo creditado e o `amount` em BRL original (independe do que chegou
// em USDT — se chegar valor diferente, o admin tem o tx_hash pra auditar).

export interface CreatedUsdtDeposit {
  id:             string
  amountBrl:      string         // valor original em R$
  amountUsdt:     string         // valor cobrado em USDT
  rate:           string         // taxa USDTBRL aplicada (auditoria)
  network:        string         // 'TRC20'
  depositAddress: string         // wallet pra o user enviar
  expiresAt:      Date | null    // quando a cobranca vence
  status:         string
  createdAt:      Date
}

export async function createUsdtDeposit(
  userId:    string,
  amountBrl: number,
): Promise<CreatedUsdtDeposit> {
  if (!isConfigured()) throw new Error('BSPAY_NOT_CONFIGURED')

  // Conta REAL do user
  const accountRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM accounts
    WHERE "userId" = ${userId} AND type = 'REAL'::"AccountType"
    LIMIT 1
  `
  if (accountRows.length === 0) throw new Error('REAL_ACCOUNT_NOT_FOUND')
  const accountId = accountRows[0].id

  // Auto-cancela PIX/crypto PENDING desta conta (igual createPixDeposit).
  // Se user gerou um QR antes e nao pagou, abandonamos pra gerar novo.
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE bonus_grants
      SET status = 'CANCELLED'::"BonusGrantStatus", "cancelledAt" = NOW()
      WHERE status = 'PENDING'::"BonusGrantStatus"
        AND "depositId" IN (
          SELECT id FROM deposits
          WHERE "accountId" = ${accountId} AND status = 'PENDING'::"DepositStatus"
        )
    `,
    prisma.$executeRaw`
      UPDATE deposits
      SET status = 'CANCELLED'::"DepositStatus", "updatedAt" = NOW(),
          notes = COALESCE(notes, '') || ' [auto-cancelado: novo deposito gerado]'
      WHERE "accountId" = ${accountId} AND status = 'PENDING'::"DepositStatus"
    `,
  ])

  // Cotacao + calculo USDT (8 casas decimais — padrao crypto)
  const rate = await getBrlToUsdtRate()
  const usdtAmount = Math.round((amountBrl / rate) * 1e8) / 1e8

  const depositId = randomUUID()
  const amountDec = new Prisma.Decimal(amountBrl)
  const usdtDec   = new Prisma.Decimal(usdtAmount.toFixed(8))

  // INSERT PENDING. amount em BRL, cryptoAmount em USDT.
  await prisma.$executeRaw`
    INSERT INTO deposits (
      id, "accountId", amount, method, status,
      "cryptoNetwork", "cryptoCurrency", "cryptoAmount",
      "createdAt", "updatedAt"
    )
    VALUES (
      ${depositId}, ${accountId}, ${amountDec},
      'CRYPTO'::"DepositMethod", 'PENDING'::"DepositStatus",
      'TRC20', 'USDT', ${usdtDec},
      NOW(), NOW()
    )
  `

  // Chama BSPay pra gerar endereco. Se falhar, marca FAILED e propaga erro.
  let depositAddress: string
  let expiresAt:      Date | null = null
  let providerId:     string | null = null
  try {
    const r = await createCryptoCashin({
      amount:      usdtAmount,
      currency:    'USDT',
      chain:       'tron',
      externalId:  depositId,
      postbackUrl: buildPostbackUrl(),
    })
    depositAddress = r.depositAddress
    expiresAt      = r.expiresAt
    providerId     = r.providerId
  } catch (err: any) {
    await prisma.$executeRaw`
      UPDATE deposits SET status = 'FAILED'::"DepositStatus", "updatedAt" = NOW()
      WHERE id = ${depositId}
    `
    throw err
  }

  // Persiste endereco + provider id pra reconciliacao do webhook
  await prisma.$executeRaw`
    UPDATE deposits
    SET "cryptoAddress" = ${depositAddress},
        "externalId"    = ${providerId},
        "updatedAt"     = NOW()
    WHERE id = ${depositId}
  `

  return {
    id:             depositId,
    amountBrl:      amountDec.toString(),
    amountUsdt:     usdtAmount.toFixed(8),
    rate:           rate.toFixed(4),
    network:        'TRC20',
    depositAddress,
    expiresAt,
    status:         'PENDING',
    createdAt:      new Date(),
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
  // ── Mitigacao de race com auto-cancel do createPixDeposit ────────────
  // Cenario: user gerou PIX1 → user gerou PIX2 (auto-cancelou PIX1 local)
  // → user pagou PIX1 no banco antes do nosso cancel propagar.
  //
  // Sem essa mitigacao, a CTE abaixo nao acharia PIX1 (status CANCELLED,
  // nao PENDING) e o pagamento real seria ignorado — user paga e nao
  // recebe credito. Aqui detectamos o caso, "reabilitamos" pra PENDING,
  // e a CTE prossegue normal.
  //
  // OBS: bonus_grant ligado ao PIX1 nao e' reativado — pode ter conflito
  // com um grant novo (do PIX2). User perde o bonus do PIX antigo mas
  // recebe o saldo do deposito. Caso degenerate, log + warn.
  const currentRows = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT status::text AS status FROM deposits WHERE id = ${depositId}
  `
  if (currentRows[0]?.status === 'CANCELLED') {
    await prisma.$executeRaw`
      UPDATE deposits
      SET status = 'PENDING'::"DepositStatus", "updatedAt" = NOW(),
          notes = COALESCE(notes, '') || ' [REATIVADO: BSPay confirmou apos auto-cancel]'
      WHERE id = ${depositId} AND status = 'CANCELLED'::"DepositStatus"
    `
    console.warn(
      `[deposits] reativado por confirmacao BSPay deposit=${depositId} — ` +
      `race condition: user pagou PIX antigo apos gerar novo`,
    )
  }

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

  // Rollover (no-bonus path): every confirmed deposit adds a multiple of
  // its value to the account's rolloverRequired. The user must trade
  // through that volume on the REAL account before withdrawal is unlocked.
  // BonusGrant has its own per-grant rollover (separate model) — these
  // two coexist and BOTH must clear before saque is allowed.
  try {
    const settings = getSettings()
    if (settings.depositRollover > 0) {
      await prisma.$executeRaw`
        UPDATE accounts
        SET "rolloverRequired" = "rolloverRequired" + (
          SELECT amount * ${settings.depositRollover}::decimal FROM deposits WHERE id = ${depositId}
        )
        WHERE id = (SELECT "accountId" FROM deposits WHERE id = ${depositId})
      `
    }
  } catch (err) {
    console.error(`[deposits] rollover update failed for deposit=${depositId}`, err)
  }

  // Auto-liquidez — reset do bankrollBaseline. Cada depósito confirmado
  // em conta REAL "zera" o contador de profit: baseline = saldo REAL
  // pós-crédito. Isso significa que o trigger de auto-ativação de
  // liquidez (worker.ts) volta a usar este saldo como ponto de partida,
  // dando ao user uma nova "rodada" antes da trava de 20% disparar.
  //
  // Para depósitos em conta DEMO (improvável — gateway só credita REAL),
  // a subquery retorna NULL e o UPDATE não toca em ninguém. Fail-safe
  // total: erro aqui NUNCA bloqueia a confirmação do depósito.
  try {
    await prisma.$executeRaw`
      UPDATE users u
      SET "bankrollBaseline" = sub.balance
      FROM (
        SELECT a."userId" AS user_id, a.balance
        FROM accounts a
        JOIN deposits d ON d."accountId" = a.id
        WHERE d.id = ${depositId} AND a.type = 'REAL'::"AccountType"
        LIMIT 1
      ) sub
      WHERE u.id = sub.user_id
    `
  } catch (err) {
    console.error(`[deposits] bankrollBaseline reset failed for deposit=${depositId}`, err)
  }

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

  // Notification email — fire-and-forget. Pull user + amount in a single
  // join so we don't pay an extra RTT just for the recipient.
  try {
    const info = await prisma.$queryRaw<Array<{
      email: string; name: string; amount: string
    }>>`
      SELECT u.email, u.name, d.amount::text AS amount
      FROM deposits d
      JOIN accounts a ON a.id = d."accountId"
      JOIN users    u ON u.id = a."userId"
      WHERE d.id = ${depositId}
      LIMIT 1
    `
    const row = info[0]
    if (row) {
      sendEmailAsync({
        templateKey: 'DEPOSIT_CONFIRMED',
        to:          row.email,
        vars:        {
          name:   row.name,
          amount: Number(row.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        },
      })
    }
  } catch (err) {
    console.error('[deposits] confirmation email lookup failed', err)
  }

  // Outbound webhook (TrackFlow integration). Distinguish first-time
  // deposit (FTD) from subsequent: query the count of PAID deposits for
  // this user. If this is the only one, it's the first. Fire-and-forget,
  // failure never affects the deposit flow.
  //
  // We re-fetch user.email here (instead of reusing `info` above) so the
  // webhook still fires even if the email block above threw early.
  try {
    const lookup = await prisma.$queryRaw<Array<{
      userId: string; email: string; name: string | null; lastName: string | null;
      phone: string | null; country: string | null;
      city: string | null; state: string | null; zip: string | null;
      amount: string; paid_count: bigint;
    }>>`
      SELECT
        u.id AS "userId",
        u.email,
        u.name,
        u."lastName",
        u.phone,
        u.country,
        u.city,
        u.state,
        u.zip,
        d.amount::text AS amount,
        (
          SELECT COUNT(*)::bigint
          FROM deposits d2
          INNER JOIN accounts a2 ON a2.id = d2."accountId"
          WHERE a2."userId" = u.id
            AND d2.status = 'PAID'::"DepositStatus"
        ) AS paid_count
      FROM deposits d
      JOIN accounts a ON a.id = d."accountId"
      JOIN users    u ON u.id = a."userId"
      WHERE d.id = ${depositId}
      LIMIT 1
    `
    const row = lookup[0]
    if (row) {
      const isFirst = Number(row.paid_count) === 1
      const value   = Number(row.amount)
      // Envia o máximo de identidade disponível (email, phone, nome,
      // external_id, country). Campos vazios são omitidos pelo sender.
      const userData = {
        id:       row.userId,
        email:    row.email,
        name:     row.name,
        lastName: row.lastName,
        phone:    row.phone,
        country:  row.country,
        city:     row.city,
        state:    row.state,
        zip:      row.zip,
      }
      const { sendFirstDepositWebhook, sendSubsequentDepositWebhook } =
        await import('../webhooks/service.js')
      if (isFirst) sendFirstDepositWebhook(userData, value)
      else         sendSubsequentDepositWebhook(userData, value)
    }
  } catch (err) {
    console.error(`[deposits] webhook dispatch failed for deposit=${depositId}`, err)
  }

  // Meta Conversions API — Purchase event. Only fires on the confirm
  // transition (this function is the ONLY caller for PENDING→PAID), so
  // dedupe via meta_events_log catches the rare double-confirm race.
  // Pulls user id + email + amount in one extra query. Phone is omitted
  // intentionally — the User model doesn't carry a verified phone field
  // we'd want to hash + send to Meta.
  try {
    const purchaseLookup = await prisma.$queryRaw<Array<{
      userId: string; email: string; amount: string;
    }>>`
      SELECT u.id AS "userId", u.email, d.amount::text AS amount
      FROM deposits d
      JOIN accounts a ON a.id = d."accountId"
      JOIN users    u ON u.id = a."userId"
      WHERE d.id = ${depositId}
      LIMIT 1
    `
    const row = purchaseLookup[0]
    if (row) {
      const { sendPurchaseAsync } = await import('../meta/service.js')
      sendPurchaseAsync(
        { id: row.userId, email: row.email },
        { id: depositId, amount: Number(row.amount) },
      )
    }
  } catch (err) {
    console.error(`[meta] Purchase enqueue failed for deposit=${depositId} (non-fatal)`, err)
  }

  return true
}
