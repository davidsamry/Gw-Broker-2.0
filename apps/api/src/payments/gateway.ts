// Abstração de gateways de depósito PIX.
//
// Objetivo: um único ponto de decisão "qual gateway usa essa cobrança nova?",
// em vez de espalhar `if (gateway === ...)` pelo projeto.
//
// REGRA DE OURO: a BSPay continua exatamente como está. Este módulo apenas
// ENCAPSULA a chamada existente (payments/bspay.createCashin) atrás de uma
// interface comum — nenhuma linha da implementação BSPay foi alterada.
//
// O gateway ativo vem de platform_settings.depositGateway (editável pelo
// admin, sem deploy). Ele decide SOMENTE onde novas cobranças são criadas:
//   - depósitos já existentes mantêm deposits.paymentGateway;
//   - os webhooks dos DOIS gateways seguem ativos o tempo todo.
//
// Sem fallback automático: se o gateway ativo falhar, o erro sobe (o depósito
// é marcado FAILED e o usuário vê a mensagem). Nunca redirecionamos silencio-
// samente a cobrança para o outro provedor.

import { getSettings } from '../settings/service.js'
import * as bspay   from './bspay.js'
import * as versell from './versell.js'
import * as skalapay from './skalapay.js'

export type GatewayId = 'bspay' | 'versell' | 'skalapay'

export const GATEWAY_IDS: GatewayId[] = ['bspay', 'versell', 'skalapay']

/**
 * Normaliza qualquer valor vindo do banco/env para um GatewayId válido.
 * Default 'bspay': valor desconhecido nunca muda o gateway de produção.
 */
export function normalizeGatewayId(value: unknown): GatewayId {
  return value === 'versell' || value === 'skalapay' ? value : 'bspay'
}

/**
 * Gateway em que um depósito FOI criado. Registros antigos (pré-multi-gateway)
 * têm paymentGateway NULL e são tratados como BSPay — preserva compatibilidade
 * com relatórios e conciliações existentes.
 */
export function gatewayOfDeposit(paymentGateway: string | null | undefined): GatewayId {
  return normalizeGatewayId(paymentGateway)
}

/** Gateway ativo para NOVAS cobranças (lido do cache de settings). */
export function getActiveGateway(): GatewayId {
  return normalizeGatewayId(getSettings().depositGateway)
}

// ── Interface comum ────────────────────────────────────────────────────────

export interface CreatePixChargeInput {
  /** Nosso Deposit.id — base da reconciliação nos dois gateways. */
  depositId:     string
  /** Valor em BRL. Decimal string com 2 casas ("10.00") — nunca float. */
  amount:        string
  payerDocument?: string
  payerName?:    string
  /** Exigidos pela SkalaPay em customer_data; ignorados pelos outros. */
  payerEmail?:   string
  payerPhone?:   string
  description?:  string
}

export interface CreatePixChargeResult {
  /** BR-Code (copia-e-cola). Mesmo contrato que o frontend já consome. */
  qrcode:     string
  /** Referência do gateway a persistir em deposits.externalId. */
  providerId: string | null
  gateway:    GatewayId
}

export interface PaymentProvider {
  readonly id: GatewayId
  isConfigured(): boolean
  createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult>
}

// ── BSPay (wrapper fino — comportamento idêntico ao atual) ─────────────────

const bspayProvider: PaymentProvider = {
  id: 'bspay',
  isConfigured: () => bspay.isConfigured(),
  async createPixCharge(input) {
    const base   = (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
    const secret = process.env.BSPAY_WEBHOOK_SECRET
    if (!secret) throw new Error('BSPAY_WEBHOOK_SECRET_MISSING')

    const cashin = await bspay.createCashin({
      // BSPay recebe number (contrato atual preservado). A string decimal vem
      // de Prisma.Decimal, então Number() aqui não introduz erro de precisão
      // em valores BRL de 2 casas.
      amount:        Number(input.amount),
      externalId:    input.depositId,
      postbackUrl:   `${base}/webhooks/bspay/${secret}`,
      payerDocument: input.payerDocument,
      payerName:     input.payerName,
    })
    return { qrcode: cashin.qrcode, providerId: cashin.providerId, gateway: 'bspay' }
  },
}

// ── Versell ────────────────────────────────────────────────────────────────

/**
 * Converte nosso Deposit.id (UUID v4) no txid exigido pela Versell:
 * 26–35 caracteres [a-zA-Z0-9]. Removendo os hífens sobram 32 hex chars,
 * dentro da faixa e sem colisão (é o mesmo UUID).
 */
export function depositIdToTxid(depositId: string): string {
  const txid = depositId.replace(/[^a-zA-Z0-9]/g, '')
  if (txid.length < 26 || txid.length > 35) {
    throw new Error(`VERSELL_TXID_DERIVATION_FAILED:${txid.length}`)
  }
  return txid
}

const versellProvider: PaymentProvider = {
  id: 'versell',
  isConfigured: () => versell.isConfigured(),
  async createPixCharge(input) {
    const txid = depositIdToTxid(input.depositId)
    const charge = await versell.createCharge({
      txid,
      amount:        input.amount,
      payerDocument: input.payerDocument,
      payerName:     input.payerName,
      description:   input.description,
    })
    // providerId = txid: é por ele que o webhook Versell localiza o depósito.
    return { qrcode: charge.pixCopiaECola, providerId: charge.txid, gateway: 'versell' }
  },
}

// ── SkalaPay ───────────────────────────────────────────────────────────────
//
// Diferença estrutural: a API da SkalaPay NÃO tem campo pra referência
// externa (a BSPay tem external_id, a Versell tem txid). Então não
// conseguimos mandar o nosso Deposit.id — a reconciliação acontece ao
// contrário, pelo id DELES, que guardamos em deposits.externalId assim que
// a cobrança nasce. O webhook procura o depósito por esse campo.
//
// O Deposit.id vai no `description` só como rastro: se algo precisar ser
// conciliado à mão no painel deles, dá pra achar pelo texto.

const skalapayProvider: PaymentProvider = {
  id: 'skalapay',
  isConfigured: () => skalapay.isConfigured(),
  async createPixCharge(input) {
    const charge = await skalapay.createCashin({
      amount:      input.amount,
      description: `Deposito VX Global #${input.depositId}`,
      customer: {
        name:  input.payerName ?? 'Cliente VX Global',
        // A SkalaPay pede email em customer_data. Quando não temos o do
        // usuário, mandamos um placeholder do nosso domínio em vez de
        // deixar vazio e tomar 422 na criação da cobrança.
        email:    input.payerEmail ?? 'no-reply@vx-global.com',
        document: input.payerDocument,
        phone:    input.payerPhone,
      },
    })
    return { qrcode: charge.qrcode, providerId: charge.transactionId, gateway: 'skalapay' }
  },
}

const PROVIDERS: Record<GatewayId, PaymentProvider> = {
  bspay:    bspayProvider,
  versell:  versellProvider,
  skalapay: skalapayProvider,
}

export function getProvider(id: GatewayId): PaymentProvider {
  return PROVIDERS[id]
}

/** Provider correspondente ao gateway ativo nas configurações. */
export function getActiveProvider(): PaymentProvider {
  return PROVIDERS[getActiveGateway()]
}

// ── Teste de credenciais ───────────────────────────────────────────────────
//
// Até aqui, credencial errada só aparecia quando um usuário real tentava
// depositar e levava "Falhou" na cara. Isto dá ao admin uma verificação
// antes, pelo painel.
//
// Em todos os três a chamada é SEM EFEITO FINANCEIRO:
//   bspay    — pede um token (emitir token não cria nem move dinheiro)
//   versell  — consulta uma cobrança que não existe
//   skalapay — consulta uma transação que não existe
//
// Nos dois últimos, "não encontrado" é justamente o resultado BOM: significa
// que o gateway nos autenticou e só não achou o registro.

export interface GatewayTestResult {
  gateway:    GatewayId
  ok:         boolean
  /** OK | NOT_CONFIGURED | UNAUTHORIZED | TIMEOUT | NETWORK_ERROR | ERROR */
  code:       string
  message:    string
  durationMs: number
}

/** Traduz o erro de qualquer um dos clientes para uma causa comum. */
function classificarFalha(err: any): { code: string; message: string } {
  const code = String(err?.code ?? '')
  const msg  = String(err?.message ?? '')
  const http = Number(err?.httpStatus ?? NaN)

  if (code.endsWith('_NOT_CONFIGURED')) {
    return { code: 'NOT_CONFIGURED', message: 'Credenciais não preenchidas nas variáveis de ambiente.' }
  }
  if (code.endsWith('_TIMEOUT') || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return { code: 'TIMEOUT', message: 'O gateway não respondeu a tempo. Pode estar fora do ar ou bloqueando nosso IP.' }
  }
  if (code.endsWith('_UNAUTHORIZED') || code.endsWith('_FORBIDDEN') || http === 401 || http === 403
      || /_AUTH_FAILED:4\d\d/.test(msg)) {
    return { code: 'UNAUTHORIZED', message: 'Gateway recusou as credenciais (401/403). Confira id e secret.' }
  }
  if (code.endsWith('_NETWORK_ERROR') || code.endsWith('_MTLS_FAILED') || code.endsWith('_CERT_READ_FAILED')) {
    return { code: 'NETWORK_ERROR', message: `Falha de conexão com o gateway: ${code || msg}`.slice(0, 200) }
  }
  // Inclui o HTTP recebido: sem ele o admin mostra so' um codigo opaco tipo
  // SKALAPAY_REQUEST_FAILED e nao da' pra saber se foi 404, 422 ou 500.
  // 5xx: ou o provedor quebrou, ou o CDN dele desistiu de esperar a origem.
  // Em 08/11/2026 a SkalaPay devolveu 504 do Cloudflare ("Error 504: Gateway
  // time-out") no POST /cash-in. Nao diz nada sobre a nossa credencial, e
  // nao ha' nada pra corrigir do nosso lado — precisa aparecer como tal, em
  // vez de um codigo generico que faz procurar erro onde nao tem.
  if (http >= 500 && http < 600) {
    return {
      code: 'GATEWAY_DOWN',
      message: `O provedor respondeu erro de servidor (HTTP ${http}). O problema e' do lado dele — as credenciais nao estao em questao.`,
    }
  }

  const detalhe = err?.detail ? String(err.detail).replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  const partes = [
    code || msg || 'Erro desconhecido',
    Number.isFinite(http) ? `HTTP ${http}` : '',
    detalhe && `resposta: ${detalhe}`,
  ].filter(Boolean)
  return { code: 'ERROR', message: partes.join(' · ').slice(0, 300) }
}

/**
 * O teste pede de proposito um recurso que nao existe. A pergunta nao e'
 * "achou?", e' "o gateway aceitou minha credencial?".
 *
 * 401/403 = recusou. Timeout e falha de rede nem chegaram la' (sem
 * httpStatus). 5xx tambem nao conta: o provedor quebrou ou o CDN dele
 * cortou antes da origem responder, entao nao aprendemos nada sobre a
 * credencial — dizer "aceita" ali seria falso positivo.
 *
 * Sobram os 4xx fora de 401/403 — 400, 404, 422, 429. Esses so' acontecem
 * depois do gateway autenticar e processar o pedido, entao a credencial
 * presta.
 *
 * Isso nasceu de um falso negativo em producao: o teste da SkalaPay exigia
 * 404 pro id inexistente, a SkalaPay respondeu outro status, e o admin
 * acusou SKALAPAY_REQUEST_FAILED num gateway que estava processando
 * depositos reais naquele minuto. Credencial errada la' da' 401
 * ("Credenciais de integracao invalidas"), que continua sendo pego.
 */
function credencialFoiAceita(err: any): boolean {
  const http = Number(err?.httpStatus)
  if (!Number.isFinite(http)) return false            // timeout / rede
  if (http === 401 || http === 403) return false      // recusa explicita
  return http >= 400 && http < 500                    // autenticou e processou
}

async function executarTeste(id: GatewayId): Promise<{ code: string; message: string }> {
  switch (id) {
    case 'bspay': {
      await bspay.pingAuth()
      return { code: 'OK', message: 'Credenciais aceitas — token emitido com sucesso.' }
    }
    case 'versell': {
      try {
        // txid de formato válido (32 chars) que nunca vai existir.
        await versell.getCharge('0'.repeat(32))
      } catch (err: any) {
        if (!credencialFoiAceita(err)) throw err
      }
      return { code: 'OK', message: 'Credenciais e mTLS aceitos pela Versell.' }
    }
    case 'skalapay': {
      try {
        await skalapay.getCashinStatus('999999999')
      } catch (err: any) {
        if (!credencialFoiAceita(err)) throw err
      }
      return { code: 'OK', message: 'Credenciais aceitas pela SkalaPay.' }
    }
  }
}

/**
 * Testa a credencial de um gateway. Nunca lança: devolve sempre um
 * resultado legível, porque quem chama é uma tela de admin.
 */
export async function testGatewayCredentials(id: GatewayId): Promise<GatewayTestResult> {
  const t0 = Date.now()
  const provider = PROVIDERS[id]

  if (!provider.isConfigured()) {
    return {
      gateway: id, ok: false, code: 'NOT_CONFIGURED',
      message: 'Credenciais não preenchidas nas variáveis de ambiente.',
      durationMs: 0,
    }
  }

  try {
    const r = await executarTeste(id)
    return { gateway: id, ok: true, ...r, durationMs: Date.now() - t0 }
  } catch (err: any) {
    const r = classificarFalha(err)
    return { gateway: id, ok: false, ...r, durationMs: Date.now() - t0 }
  }
}
