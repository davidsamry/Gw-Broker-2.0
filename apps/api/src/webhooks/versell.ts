import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../prisma.js'
import { confirmDepositById } from '../deposits/service.js'
import { gatewayOfDeposit } from '../payments/gateway.js'

// Webhook Versell (Cash In) — SEPARADO do webhook BSPay.
//
// Ambos os webhooks ficam ativos permanentemente: o gateway selecionado no
// admin decide apenas onde novas cobranças são criadas, nunca quais webhooks
// são processados. Um depósito Versell pendente continua sendo confirmado
// mesmo se o admin voltar o gateway ativo para BSPay (e vice-versa).
//
// DEFESA EM DUAS CAMADAS:
//   1) Path-secret (VERSELL_WEBHOOK_SECRET na URL), comparação timing-safe.
//   2) Header X-Webhook-Secret, obrigatório conforme a doc oficial
//      ("Sempre valide o header X-Webhook-Secret em produção").
//      Configurável via VERSELL_WEBHOOK_HEADER_SECRET; se ausente, caímos
//      para VERSELL_WEBHOOK_SECRET (mesmo valor do path).
//
// PAYLOAD (doc oficial /docs/testing/webhook-examples):
//   {
//     "data": {
//       "id": 825099,
//       "txId": "0e7a2986324d6a9644cb6bf3458286",
//       "pixKey": "...",
//       "status": "LIQUIDATED",
//       "payment": { "amount": "25.00", "currency": "BRL" },
//       "endToEndId": "E00360305...",
//       "createdAt": "2026-04-08T19:13:43.290+00:00"
//     },
//     "type": "RECEIVE"
//   }
//
// NOTA DE ROTA: a Versell ACRESCENTA "/pix" à URL registrada. Por isso
// registramos as duas variantes (com e sem o sufixo).

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/** Status da Versell → status interno da VX Global (modelo atual preservado). */
export function mapVersellStatus(status: string): 'PAID' | 'PENDING' | 'EXPIRED' | 'FAILED' | 'UNKNOWN' {
  switch ((status ?? '').toUpperCase()) {
    case 'LIQUIDATED':
    case 'CONCLUIDA':
    case 'PAID':
      return 'PAID'
    case 'ATIVA':
    case 'PENDING':
    case 'WAITING':
      return 'PENDING'
    case 'EXPIRED':
    case 'REMOVIDA_PELO_USUARIO_RECEBEDOR':
    case 'REMOVIDA_PELO_PSP':
      return 'EXPIRED'
    case 'FAILED':
    case 'ERROR':
      return 'FAILED'
    default:
      return 'UNKNOWN'
  }
}

interface HandleResult { status: number; body: Record<string, unknown> }

export async function versellWebhookRoutes(app: FastifyInstance) {
  const handle = async (req: any, reply: any) => {
    // ── Camada 1: path-secret ───────────────────────────────────────────
    const { secret } = req.params as { secret: string }
    const expectedPath = process.env.VERSELL_WEBHOOK_SECRET
    if (!expectedPath || !timingSafeEq(secret ?? '', expectedPath)) {
      // 404 (não 401) pra não revelar que a rota existe.
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    // ── Camada 2: header X-Webhook-Secret (obrigatório) ─────────────────
    const expectedHeader = process.env.VERSELL_WEBHOOK_HEADER_SECRET || expectedPath
    const got = req.headers['x-webhook-secret']
    const gotStr = typeof got === 'string' ? got : ''
    if (!gotStr || !timingSafeEq(gotStr, expectedHeader)) {
      req.log.warn('[VERSELL] Webhook rejected — invalid or missing X-Webhook-Secret')
      return reply.status(401).send({ error: 'INVALID_WEBHOOK_SECRET' })
    }

    const body = (req.body ?? {}) as any
    const data = body?.data ?? {}
    const txId = data?.txId ?? data?.txid ?? null
    const rawStatus  = data?.status ?? ''
    const mapped     = mapVersellStatus(rawStatus)
    const endToEndId = data?.endToEndId ?? null
    const amountStr  = data?.payment?.amount ?? null

    req.log.info({ txId, status: rawStatus, type: body?.type }, '[VERSELL] Webhook received')

    if (!txId) return reply.send({ ok: true, acted: false, reason: 'NO_TXID' })

    // Só liquidação credita saldo. Demais status são registrados e ignorados.
    if (mapped !== 'PAID') {
      req.log.info({ txId, status: rawStatus, mapped }, '[VERSELL] Non-settlement event ignored')
      return reply.send({ ok: true, acted: false, reason: 'NOT_LIQUIDATED' })
    }

    const result = await settleVersellDeposit({
      txId, amountStr, endToEndId,
      log: (msg: string, extra?: object) => req.log.info(extra ?? {}, msg),
      warn: (msg: string, extra?: object) => req.log.warn(extra ?? {}, msg),
    })
    return reply.status(result.status).send(result.body)
  }

  // A Versell acrescenta "/pix" à URL registrada — aceitamos as duas formas.
  app.post('/versell/:secret', handle)
  app.post('/versell/:secret/pix', handle)
}

/**
 * Localiza o depósito pelo txid, valida e credita — reaproveitando
 * `confirmDepositById`, a MESMA função usada pela BSPay (crédito de saldo,
 * transação DEPOSIT, rollover, bônus e baseline de auto-liquidez).
 *
 * Idempotência em duas camadas:
 *   1) aqui: se o depósito já não estiver PENDING, ignora e loga;
 *   2) em confirmDepositById: a CTE só atualiza linhas PENDING, então um
 *      webhook repetido em corrida não credita duas vezes.
 */
export async function settleVersellDeposit(args: {
  txId:       string
  amountStr:  string | null
  endToEndId: string | null
  log:  (msg: string, extra?: object) => void
  warn: (msg: string, extra?: object) => void
}): Promise<HandleResult> {
  const { txId, amountStr, endToEndId, log, warn } = args

  // externalId guarda o txid (definido por nós na criação da cobrança).
  const rows = await prisma.$queryRaw<Array<{
    id: string; status: string; amount: any; paymentGateway: string | null
  }>>`
    SELECT id, status::text AS status, amount, "paymentGateway"
    FROM deposits
    WHERE "externalId" = ${txId}
    LIMIT 1
  `
  const dep = rows[0]
  if (!dep) {
    warn('[VERSELL] Deposit not found for txid', { txId })
    // 200: reprocessar não vai fazer aparecer. Evita retry infinito.
    return { status: 200, body: { ok: true, acted: false, reason: 'DEPOSIT_NOT_FOUND' } }
  }

  // Garante que o depósito pertence MESMO à Versell — um webhook Versell
  // nunca pode liquidar um depósito criado na BSPay.
  if (gatewayOfDeposit(dep.paymentGateway) !== 'versell') {
    warn('[VERSELL] Gateway mismatch — refusing to settle', { txId, depositId: dep.id })
    return { status: 200, body: { ok: true, acted: false, reason: 'GATEWAY_MISMATCH' } }
  }

  // Confere o valor pago contra o valor cobrado (comparação decimal, sem float).
  if (amountStr != null) {
    const expected = Number(dep.amount)
    const paid     = Number(amountStr)
    if (!Number.isFinite(paid) || Math.abs(paid - expected) > 0.001) {
      warn('[VERSELL] Amount mismatch — NOT crediting', {
        txId, depositId: dep.id, expected: expected.toFixed(2), paid: amountStr,
      })
      // Em dúvida sobre o valor, o depósito permanece PENDENTE para
      // conferência manual do admin. Nunca creditamos valor divergente.
      return { status: 200, body: { ok: true, acted: false, reason: 'AMOUNT_MISMATCH' } }
    }
  }

  // Idempotência (camada 1) — webhook repetido para depósito já pago.
  if (dep.status === 'PAID') {
    log('[VERSELL] Duplicate webhook ignored — deposit already paid', { txId, depositId: dep.id })
    return { status: 200, body: { ok: true, acted: false, reason: 'ALREADY_PAID' } }
  }

  // Auditoria: guarda o endToEndId antes de creditar. Falha aqui não bloqueia.
  if (endToEndId) {
    try {
      await prisma.$executeRaw`
        UPDATE deposits
        SET notes = COALESCE(notes, '') || ${` [versell e2e:${endToEndId}]`},
            "updatedAt" = NOW()
        WHERE id = ${dep.id} AND COALESCE(notes, '') NOT LIKE ${`%${endToEndId}%`}
      `
    } catch (err) {
      warn('[VERSELL] Failed to persist endToEndId (non-fatal)', { txId })
    }
  }

  log('[VERSELL] Payment liquidated — crediting deposit', { txId, depositId: dep.id })

  try {
    // Idempotência (camada 2) + atomicidade: a CTE interna só age em PENDING.
    const acted = await confirmDepositById(dep.id)
    if (acted) log('[VERSELL] Deposit credited', { txId, depositId: dep.id })
    else       log('[VERSELL] Duplicate webhook ignored — no state change', { txId, depositId: dep.id })
    return { status: 200, body: { ok: true, acted } }
  } catch (err: any) {
    // 500 → a Versell reenvia. Nunca creditamos em estado ambíguo.
    warn('[VERSELL] Failed to credit deposit', { txId, depositId: dep.id, err: String(err?.message ?? err).slice(0, 200) })
    return { status: 500, body: { ok: false } }
  }
}
