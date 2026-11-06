// SkalaPay — cliente HTTP (PIX cash-in + cash-out).
// Base: https://skalapay.net/api
//
// Env necessárias:
//   SKALAPAY_CLIENT_ID       — header X-Client-Id
//   SKALAPAY_CLIENT_SECRET   — header X-Client-Secret
//   SKALAPAY_BASE_URL        — opcional, default https://skalapay.net/api
//   SKALAPAY_WEBHOOK_SECRET  — segredo no PATH do nosso webhook
//
// Sem credencial toda chamada lança SKALAPAY_NOT_CONFIGURED — o frontend
// mostra erro limpo, nunca um QR falso.
//
// ── TRÊS DIFERENÇAS EM RELAÇÃO AOS OUTROS GATEWAYS ───────────────────────
//
// 1. NÃO HÁ CAMPO PARA A NOSSA REFERÊNCIA. A BSPay aceita `external_id` e a
//    Versell aceita `txid` — nos dois mandamos o nosso Deposit.id e o
//    webhook devolve ele. A SkalaPay não tem esse campo: a criação só
//    aceita amount / payment_method / description / customer_data, e o
//    `order_id` é gerado por ELES. Logo a reconciliação é pelo id DELES,
//    guardado em deposits.externalId na criação. O nosso Deposit.id vai
//    dentro do `description`, como rastro de auditoria no painel deles.
//
// 2. NÃO HÁ AUTENTICAÇÃO NO WEBHOOK. A spec não define assinatura HMAC nem
//    header secreto — quem descobrir a URL consegue forjar "pago". Por isso
//    o handler nunca credita com base no corpo recebido: ele reconsulta
//    GET /cash-in/{id} e só credita se a própria SkalaPay confirmar.
//    Ver webhooks/skalapay.ts.
//
// 3. SEM TOKEN. Não existe /oauth/token: as credenciais vão em header a
//    cada request. Não há token pra cachear nem renovar (ao contrário da
//    BSPay, onde justamente o OAuth causou 20 das 71 falhas históricas).

const DEFAULT_BASE_URL = 'https://skalapay.net/api'

// Calibrados na dor da BSPay (06/11/2026): a criação é a chamada que o
// usuário espera olhando a tela, então vai folgada; consultas são internas
// e podem desistir mais cedo.
const CREATE_TIMEOUT_MS = 25_000
const READ_TIMEOUT_MS   = 15_000

export class SkalaPayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus?: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'SkalaPayError'
  }
}

interface SkalaPayConfig {
  baseUrl:      string
  clientId:     string
  clientSecret: string
}

function readConfig(): SkalaPayConfig {
  const baseUrl      = (process.env.SKALAPAY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const clientId     = process.env.SKALAPAY_CLIENT_ID
  const clientSecret = process.env.SKALAPAY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new SkalaPayError('SkalaPay sem credenciais', 'SKALAPAY_NOT_CONFIGURED')
  }
  return { baseUrl, clientId, clientSecret }
}

export function isConfigured(): boolean {
  return !!(process.env.SKALAPAY_CLIENT_ID && process.env.SKALAPAY_CLIENT_SECRET)
}

/**
 * Request autenticado. As credenciais vão em header e NUNCA aparecem em log
 * ou mensagem de erro — só o status e um trecho curto do corpo.
 */
async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body: unknown | undefined,
  timeoutMs: number,
): Promise<T> {
  const { baseUrl, clientId, clientSecret } = readConfig()

  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'X-Client-Id':     clientId,
        'X-Client-Secret': clientSecret,
        'Content-Type':    'application/json',
        'Accept':          'application/json',
      },
      body:   body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    throw new SkalaPayError(
      timeout
        ? `Timeout de ${timeoutMs}ms em ${method} ${path}`
        : `Falha de rede em ${method} ${path}`,
      timeout ? 'SKALAPAY_TIMEOUT' : 'SKALAPAY_NETWORK_ERROR',
      undefined,
      err?.message,
    )
  }

  const texto = await res.text().catch(() => '')
  if (!res.ok) {
    throw new SkalaPayError(
      `SkalaPay respondeu ${res.status} em ${method} ${path}`,
      res.status === 401 || res.status === 403
        ? 'SKALAPAY_UNAUTHORIZED'
        : 'SKALAPAY_REQUEST_FAILED',
      res.status,
      texto.slice(0, 400),
    )
  }

  try {
    return (texto ? JSON.parse(texto) : {}) as T
  } catch {
    throw new SkalaPayError(
      `Resposta não-JSON em ${method} ${path}`,
      'SKALAPAY_INVALID_RESPONSE',
      res.status,
      texto.slice(0, 200),
    )
  }
}

// ── Status ─────────────────────────────────────────────────────────────────

export type SkalaPayStatus =
  | 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED'
  | 'CANCELLED' | 'REFUNDED' | 'CHARGEBACK' | 'UNKNOWN'

/** Normaliza o status da SkalaPay (chega em maiúscula ou minúscula). */
export function normalizeStatus(raw: unknown): SkalaPayStatus {
  switch (String(raw ?? '').toUpperCase()) {
    case 'PENDING':    return 'PENDING'
    case 'PROCESSING': return 'PROCESSING'
    case 'PAID':       return 'PAID'
    case 'FAILED':     return 'FAILED'
    case 'CANCELLED':  return 'CANCELLED'
    case 'REFUNDED':   return 'REFUNDED'
    case 'CHARGEBACK': return 'CHARGEBACK'
    default:           return 'UNKNOWN'
  }
}

// ── Cash-in (cobrança PIX) ────────────────────────────────────────────────

export interface CashinInput {
  /** BRL com 2 casas, string decimal — convertida pra number na borda. */
  amount:      string
  description: string
  customer: {
    name:      string
    email:     string
    /** CPF/CNPJ só dígitos. */
    document?: string
    phone?:    string
  }
}

export interface CashinResult {
  /** id da SkalaPay — vira o nosso deposits.externalId. */
  transactionId: string
  /** "CASHIN_..." gerado por eles. */
  orderId:       string | null
  status:        SkalaPayStatus
  /** PIX copia-e-cola (EMV). */
  qrcode:        string
  /** PNG base64, quando vier. O nosso frontend desenha o QR a partir do
   *  EMV, então isto fica só como extra. */
  qrcodeBase64:  string | null
  expiresAt:     Date | null
  raw:           unknown
}

/**
 * Cria a cobrança PIX.
 *
 * SEM RETRY, de propósito — mesma regra da BSPay: timeout aqui não
 * significa "não criou", significa "não sei". Em 06/11/2026 a BSPay gerou
 * duas cobranças 3-4 min DEPOIS de estourarmos o timeout. Repetir o POST
 * criaria cobrança duplicada. Só ligar retry se a SkalaPay confirmar por
 * escrito que deduplica.
 */
export async function createCashin(input: CashinInput): Promise<CashinResult> {
  const json = await request<any>('POST', '/cash-in', {
    amount:         Number(input.amount),
    payment_method: 'pix',
    description:    input.description,
    customer_data: {
      name:     input.customer.name,
      email:    input.customer.email,
      document: input.customer.document,
      phone:    input.customer.phone,
    },
  }, CREATE_TIMEOUT_MS)

  // Defensivo quanto ao caminho exato dos campos: provedores mudam nomes.
  const tx  = json?.transaction ?? json?.data?.transaction ?? json?.data ?? json
  const acq = tx?.acquirer_response ?? json?.acquirer_response ?? {}

  const qrcode = acq?.qr_code ?? acq?.qrcode ?? tx?.qr_code ?? null
  const txId   = tx?.id ?? tx?.transaction_id ?? json?.transaction_id ?? null

  if (!qrcode) {
    throw new SkalaPayError(
      'SkalaPay não devolveu o PIX copia-e-cola',
      'SKALAPAY_MISSING_QRCODE',
      undefined,
      JSON.stringify(json).slice(0, 300),
    )
  }
  if (txId == null) {
    // Sem id não há como reconciliar o webhook depois. Melhor falhar agora,
    // enquanto o usuário ainda não viu QR nenhum, do que aceitar uma
    // cobrança que a gente nunca conseguiria confirmar.
    throw new SkalaPayError(
      'SkalaPay não devolveu o id da transação',
      'SKALAPAY_MISSING_TRANSACTION_ID',
      undefined,
      JSON.stringify(json).slice(0, 300),
    )
  }

  const expires = acq?.expires_at ?? tx?.expires_at ?? null

  return {
    transactionId: String(txId),
    orderId:       tx?.order_id != null ? String(tx.order_id) : null,
    status:        normalizeStatus(tx?.status),
    qrcode:        String(qrcode),
    qrcodeBase64:  acq?.qr_code_base64 ? String(acq.qr_code_base64) : null,
    expiresAt:     expires ? new Date(expires) : null,
    raw:           json,
  }
}

export interface StatusResult {
  transactionId: string | null
  orderId:       string | null
  status:        SkalaPayStatus
  /** Valor conforme a SkalaPay. Serve pra conferir contra o nosso. */
  amount:        string | null
  paidAt:        Date | null
  raw:           unknown
}

function parseStatus(json: any): StatusResult {
  const tx = json?.transaction ?? json?.data?.transaction ?? json?.data ?? json
  const paid = tx?.paid_at ?? null
  return {
    transactionId: tx?.id != null ? String(tx.id) : null,
    orderId:       tx?.order_id != null ? String(tx.order_id) : null,
    status:        normalizeStatus(tx?.status),
    amount:        tx?.amount != null ? String(tx.amount) : null,
    paidAt:        paid ? new Date(paid) : null,
    raw:           json,
  }
}

/**
 * Consulta o estado real da cobrança. É a fonte da verdade do webhook —
 * ver a nota 2 no topo do arquivo. Aceita o id numérico ou o order_id.
 */
export async function getCashinStatus(transactionId: string): Promise<StatusResult> {
  return parseStatus(await request<any>(
    'GET',
    `/cash-in/${encodeURIComponent(transactionId)}`,
    undefined,
    READ_TIMEOUT_MS,
  ))
}

// ── Cash-out (saque PIX) ──────────────────────────────────────────────────

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'EVP'

export interface CashoutInput {
  amount:      string        // BRL, string decimal
  pixKey:      string
  pixKeyType:  PixKeyType
  description: string
}

export interface CashoutResult {
  success:       boolean
  message:       string | null
  transactionId: string | null
  /** Saldo restante na conta SkalaPay após o saque. */
  balance:       string | null
  raw:           unknown
}

/**
 * Solicita transferência PIX (dinheiro SAINDO).
 *
 * SEM RETRY — e aqui a regra é mais dura ainda que no cash-in: repetir um
 * POST que já pode ter sido processado paga a pessoa DUAS VEZES. Em
 * timeout, quem decide é um humano, consultando getCashoutStatus.
 *
 * ATENÇÃO: esta função NÃO está ligada ao fluxo de saque do admin. Hoje
 * aprovar saque só muda o status no nosso banco (approveWithdrawal) e o PIX
 * é enviado à mão. Automatizar isso é uma decisão à parte — seria o
 * primeiro dinheiro saindo da plataforma sem humano no meio.
 */
export async function createCashout(input: CashoutInput): Promise<CashoutResult> {
  const json = await request<any>('POST', '/cash-out', {
    amount:         Number(input.amount),
    payment_method: 'pix',
    pix_key:        input.pixKey,
    pix_key_type:   input.pixKeyType,
    description:    input.description,
  }, CREATE_TIMEOUT_MS)

  return {
    success:       json?.success === true,
    message:       json?.message != null ? String(json.message) : null,
    transactionId: json?.transaction_id != null ? String(json.transaction_id) : null,
    balance:       json?.balance != null ? String(json.balance) : null,
    raw:           json,
  }
}

export async function getCashoutStatus(transactionId: string): Promise<StatusResult> {
  return parseStatus(await request<any>(
    'GET',
    `/cash-out/${encodeURIComponent(transactionId)}`,
    undefined,
    READ_TIMEOUT_MS,
  ))
}
