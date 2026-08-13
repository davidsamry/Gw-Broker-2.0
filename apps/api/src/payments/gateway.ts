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

export type GatewayId = 'bspay' | 'versell'

export const GATEWAY_IDS: GatewayId[] = ['bspay', 'versell']

/** Normaliza qualquer valor vindo do banco/env para um GatewayId válido. */
export function normalizeGatewayId(value: unknown): GatewayId {
  return value === 'versell' ? 'versell' : 'bspay'
}

/**
 * Gateway em que um depósito FOI criado. Registros antigos (pré-multi-gateway)
 * têm paymentGateway NULL e são tratados como BSPay — preserva compatibilidade
 * com relatórios e conciliações existentes.
 */
export function gatewayOfDeposit(paymentGateway: string | null | undefined): GatewayId {
  return paymentGateway === 'versell' ? 'versell' : 'bspay'
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

const PROVIDERS: Record<GatewayId, PaymentProvider> = {
  bspay:   bspayProvider,
  versell: versellProvider,
}

export function getProvider(id: GatewayId): PaymentProvider {
  return PROVIDERS[id]
}

/** Provider correspondente ao gateway ativo nas configurações. */
export function getActiveProvider(): PaymentProvider {
  return PROVIDERS[getActiveGateway()]
}
