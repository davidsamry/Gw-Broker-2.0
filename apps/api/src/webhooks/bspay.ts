import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { confirmDepositById } from '../deposits/service.js'

// BSPay webhook handler — Sec O2.3 hardened.
//
// Defesa em DUAS camadas:
//
//  1) Path-bearer (camada 1): O secret na URL (BSPAY_WEBHOOK_SECRET) age
//     como bearer simples — atacante que nao conhece a URL ja para aqui.
//     Comparacao timing-safe (constant-time) pra evitar timing attacks na
//     descoberta byte-a-byte da string.
//
//  2) HMAC-SHA256 (camada 2): O BSPay assina o raw body com um
//     webhook_secret separado (configurado no Dashboard deles quando voce
//     ativa HMAC pra credencial) e envia:
//
//       X-Webhook-Signature: hex(hmac_sha256(raw_body, webhook_secret))
//       X-Webhook-Timestamp: <unix_seconds>
//
//     Aceitamos ±5min de skew (mesma recomendacao da doc deles) pra
//     impedir replay de webhooks antigos.
//
//     ATIVACAO: setar BSPAY_WEBHOOK_HMAC_SECRET no EasyPanel APOS ativar
//     HMAC no Dashboard BSPay. Enquanto a env nao estiver setada, o handler
//     funciona como antes (so path-secret) mas LOGA warning loud em prod
//     pra forcar a configuracao.

const MAX_TIMESTAMP_SKEW_SEC = 300  // ±5 min — recomendacao oficial BSPay

/**
 * Constant-time string equality. Buffers de tamanhos diferentes retornam
 * false sem comparar (timingSafeEqual ja exige tamanhos iguais).
 */
function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export async function bspayWebhookRoutes(app: FastifyInstance) {
  // ── Raw body capture ──────────────────────────────────────────────────────
  // A assinatura HMAC e calculada sobre os BYTES do body — se a gente
  // re-serializar via JSON.stringify o resultado pode mudar (ordem de
  // keys, espacos, acentos com escape diferente) e a assinatura quebra.
  // Por isso instalamos um content-type parser local ao escopo desse
  // plugin que guarda o Buffer original em req.rawBody antes de parsear
  // pra JSON. Como Fastify isola parsers por encapsulation context, isso
  // NAO afeta as outras rotas da app.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const buf    = body as Buffer
        const parsed = buf.length ? JSON.parse(buf.toString('utf8')) : {}
        ;(req as any).rawBody = buf
        done(null, parsed)
      } catch (err: any) {
        err.statusCode = 400
        done(err, undefined)
      }
    },
  )

  app.post('/bspay/:secret', async (req, reply) => {
    // ── Camada 1: path-secret bearer (timing-safe) ──────────────────────────
    const { secret } = req.params as { secret: string }
    const expectedPath = process.env.BSPAY_WEBHOOK_SECRET
    if (!expectedPath || !timingSafeEq(secret, expectedPath)) {
      // Mimic 404 pra atacante nao conseguir distinguir "endpoint
      // inexistente" de "secret errado" via probe.
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    // ── Camada 2: HMAC + timestamp (se ativada) ─────────────────────────────
    const hmacSecret = process.env.BSPAY_WEBHOOK_HMAC_SECRET
    if (hmacSecret) {
      const tsHeader  = req.headers['x-webhook-timestamp']
      const sigHeader = req.headers['x-webhook-signature']
      const ts        = typeof tsHeader  === 'string' ? Number(tsHeader) : NaN
      const sig       = typeof sigHeader === 'string' ? sigHeader        : ''

      if (!Number.isFinite(ts) || !sig) {
        req.log.warn({ hasTs: Number.isFinite(ts), hasSig: !!sig }, 'BSPay webhook missing signature headers')
        return reply.status(401).send({ error: 'MISSING_SIGNATURE' })
      }

      const nowSec = Math.floor(Date.now() / 1000)
      const skew   = Math.abs(nowSec - ts)
      if (skew > MAX_TIMESTAMP_SKEW_SEC) {
        req.log.warn({ ts, nowSec, skew }, 'BSPay webhook timestamp out of window')
        return reply.status(401).send({ error: 'STALE_SIGNATURE' })
      }

      const rawBody = (req as any).rawBody as Buffer | undefined
      if (!rawBody) {
        // Bug interno: content-type parser nao rodou. Nunca deve acontecer
        // em prod com content-type=application/json.
        req.log.error('BSPay webhook missing rawBody — content-type parser issue')
        return reply.status(500).send({ error: 'INTERNAL' })
      }

      const expectedSig = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('hex')
      if (!timingSafeEq(sig.toLowerCase(), expectedSig.toLowerCase())) {
        req.log.warn({ ts }, 'BSPay webhook signature mismatch')
        return reply.status(401).send({ error: 'INVALID_SIGNATURE' })
      }
    } else if (process.env.NODE_ENV === 'production') {
      // HMAC nao configurado em prod — loga warn em CADA request pra
      // forcar a configuracao. Nao bloqueamos (pra nao quebrar deposits
      // ate o user ativar HMAC no Dashboard BSPay), mas o log fica gritando.
      req.log.warn(
        'BSPAY_WEBHOOK_HMAC_SECRET ausente em producao — webhook aceito SO com path-secret. ' +
        'Ative HMAC no Dashboard BSPay e seta a env var pra protecao real.',
      )
    }

    // ── Processamento (PIX + crypto compartilham fluxo) ────────────────────
    const body       = (req.body ?? {}) as any
    const event      = body.event ?? body.type ?? ''
    const data       = body.data ?? body
    const externalId = body.external_id ?? body.externalId ?? data?.external_id
    const status     = (body.status ?? data?.status ?? '').toLowerCase()
    // currency_type='crypto' diferencia de PIX ('fiat')
    const isCrypto   = data?.currency_type === 'crypto'

    req.log.info({ event, externalId, status, isCrypto }, 'BSPay webhook received')

    const isConfirmed =
      event === 'cashin.confirmed' ||
      status === 'paid'            ||
      status === 'confirmed'

    if (!isConfirmed || !externalId) {
      return reply.send({ ok: true, acted: false })
    }

    // Crypto: persiste tx_hash + from_address pra auditoria on-chain
    // ANTES de creditar. Failure aqui nao bloqueia o credit (apenas perda
    // de auditoria — o admin pode buscar manual via BSPay dashboard).
    if (isCrypto) {
      try {
        const txHash   = data?.tx_hash ?? data?.txHash ?? null
        const fromAddr = data?.from_address ?? data?.from ?? null
        if (txHash || fromAddr) {
          const { prisma } = await import('../prisma.js')
          await prisma.$executeRaw`
            UPDATE deposits
            SET "cryptoTxHash"   = COALESCE(${txHash},   "cryptoTxHash"),
                "cryptoFromAddr" = COALESCE(${fromAddr}, "cryptoFromAddr"),
                "updatedAt"      = NOW()
            WHERE id = ${externalId}
          `
        }
      } catch (err) {
        req.log.warn({ err, externalId }, 'Crypto webhook: failed to persist tx_hash (non-fatal)')
      }
    }

    try {
      const acted = await confirmDepositById(externalId)
      return reply.send({ ok: true, acted })
    } catch (err: any) {
      // Log + return 500 so BSPay retries (per docs, exponential backoff
      // for up to 5 attempts).
      req.log.error({ err, externalId }, 'Failed to confirm deposit')
      return reply.status(500).send({ ok: false })
    }
  })
}
