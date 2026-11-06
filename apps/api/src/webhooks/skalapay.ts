import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../prisma.js'
import { confirmDepositById } from '../deposits/service.js'
import { getCashinStatus } from '../payments/skalapay.js'

// Webhook SkalaPay (cash-in) — separado dos webhooks BSPay e Versell.
//
// Como nos outros, este webhook fica ativo PERMANENTEMENTE: o gateway
// escolhido no admin decide apenas onde novas cobranças nascem, nunca quais
// confirmações são processadas. Um PIX SkalaPay pendente continua sendo
// confirmado mesmo se o admin voltar o gateway ativo pra BSPay.
//
// ── POR QUE ESTE HANDLER NÃO CONFIA NO CORPO RECEBIDO ────────────────────
//
// A especificação da SkalaPay não define NENHUMA autenticação de webhook:
// sem HMAC, sem header secreto, sem assinatura. Num sistema com dinheiro
// real isso é inaceitável sozinho — quem descobrisse a URL mandaria
//
//     {"event":"cashin.confirmed","status":"paid","transaction_id":1420}
//
// e sairia com saldo de graça. Então são duas camadas:
//
//   1) Path-secret (SKALAPAY_WEBHOOK_SECRET na URL), comparação timing-safe.
//      Barra quem não conhece a URL. É o mesmo que fazemos nos outros dois.
//
//   2) RECONSULTA OBRIGATÓRIA. O corpo recebido serve só pra saber QUAL
//      transação olhar. Antes de creditar, chamamos GET /cash-in/{id} com
//      as nossas credenciais e só seguimos se a PRÓPRIA SkalaPay disser
//      PAID. Um webhook forjado não sobrevive a isso, porque o atacante
//      não consegue alterar a resposta da API deles.
//
// O custo é uma chamada HTTP extra por confirmação. Para dinheiro entrando,
// é barato.
//
// ── RECONCILIAÇÃO ─────────────────────────────────────────────────────────
//
// Ao contrário da BSPay (external_id) e da Versell (txid), a SkalaPay não
// aceita referência nossa na criação. Então o caminho é inverso: achamos o
// depósito pelo id DELES, que foi gravado em deposits.externalId quando a
// cobrança nasceu. A busca é restrita a paymentGateway='skalapay' pra um id
// numérico curto nunca colidir com externalId de outro provedor.

const EVENTOS_DE_PAGAMENTO = new Set(['cashin.confirmed', 'cash_in.confirmed', 'cashin.paid'])

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * Localiza o nosso depósito pelo identificador da SkalaPay. Tenta o
 * transaction_id e, se não achar, o order_id — a doc diz que os dois
 * servem como chave na consulta, então aceitamos os dois aqui também.
 */
async function acharDeposito(ids: Array<string | null>): Promise<
  { id: string; status: string; amount: string } | null
> {
  const candidatos = ids.filter((x): x is string => !!x && x.trim() !== '')
  if (candidatos.length === 0) return null

  const rows = await prisma.$queryRaw<Array<{ id: string; status: string; amount: string }>>`
    SELECT id, status::text AS status, amount::text AS amount
    FROM deposits
    WHERE "paymentGateway" = 'skalapay'
      AND "externalId" = ANY(${candidatos}::text[])
    ORDER BY "createdAt" DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

/** Compara valores monetários em centavos — evita o float do JS. */
function mesmoValor(a: string, b: string): boolean {
  const cent = (v: string) => Math.round(parseFloat(v) * 100)
  const ca = cent(a), cb = cent(b)
  return Number.isFinite(ca) && Number.isFinite(cb) && ca === cb
}

export async function skalapayWebhookRoutes(app: FastifyInstance) {
  app.post('/skalapay/:secret', async (req, reply) => {
    // ── Camada 1: path-secret ───────────────────────────────────────────
    const { secret } = req.params as { secret: string }
    const esperado = process.env.SKALAPAY_WEBHOOK_SECRET
    if (!esperado || !timingSafeEq(secret, esperado)) {
      // 404 em vez de 401: um atacante sondando não consegue distinguir
      // "rota não existe" de "segredo errado".
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    const body    = (req.body ?? {}) as any
    const evento  = String(body.event ?? '')
    const status  = String(body.status ?? '').toLowerCase()
    const txId    = body.transaction_id != null ? String(body.transaction_id) : null
    const orderId = body.order_id       != null ? String(body.order_id)       : null

    req.log.info({ evento, txId, orderId, status }, 'SkalaPay webhook recebido')

    // Eventos que não são confirmação de pagamento: 200 e segue a vida (um
    // não-2xx faria a SkalaPay reenviar pra sempre uma coisa que a gente
    // simplesmente não trata).
    const pareceConfirmacao = EVENTOS_DE_PAGAMENTO.has(evento) || status === 'paid'
    if (!pareceConfirmacao || (!txId && !orderId)) {
      return reply.send({ received: true, acted: false })
    }

    const dep = await acharDeposito([txId, orderId])
    if (!dep) {
      // Pode ser corrida (webhook chegou antes de gravarmos o externalId)
      // ou webhook forjado. Nos dois casos a resposta é a mesma: 200 pra
      // não gerar retry infinito, e log alto pra conciliação manual.
      req.log.error(
        { txId, orderId },
        'SkalaPay confirmou pagamento de transação sem depósito correspondente — conferir no painel',
      )
      return reply.send({ received: true, acted: false })
    }

    if (dep.status === 'PAID') {
      return reply.send({ received: true, acted: false })   // idempotente
    }

    // ── Camada 2: a SkalaPay precisa confirmar por conta própria ────────
    let real
    try {
      real = await getCashinStatus(txId ?? orderId!)
    } catch (err: any) {
      // Não conseguimos verificar → NÃO creditamos. 500 faz a SkalaPay
      // reenviar, e aí tentamos de novo. Creditar sem verificar seria
      // exatamente o buraco que esta camada existe pra fechar.
      req.log.error(
        { code: err?.code, httpStatus: err?.httpStatus, txId },
        'SkalaPay: falha ao reconsultar a transação — crédito adiado',
      )
      return reply.status(500).send({ received: false, error: 'VERIFICATION_FAILED' })
    }

    if (real.status !== 'PAID') {
      req.log.warn(
        { txId, statusNoWebhook: status, statusReal: real.status },
        'SkalaPay: webhook disse pago mas a API diz outra coisa — ignorado',
      )
      return reply.send({ received: true, acted: false })
    }

    // Valor tem que bater com o que registramos. Divergência aqui é sinal
    // de problema sério (cobrança trocada, adulteração) — não credita.
    if (real.amount && !mesmoValor(real.amount, dep.amount)) {
      req.log.error(
        { txId, valorSkalaPay: real.amount, valorNosso: dep.amount, depositId: dep.id },
        'SkalaPay: valor divergente do depósito — crédito bloqueado, conferir à mão',
      )
      return reply.send({ received: true, acted: false })
    }

    try {
      const acted = await confirmDepositById(dep.id)
      return reply.send({ received: true, acted })
    } catch (err) {
      req.log.error({ err, depositId: dep.id }, 'SkalaPay: falha ao confirmar depósito')
      return reply.status(500).send({ received: false })
    }
  })
}
