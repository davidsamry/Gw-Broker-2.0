// Versell PIX gateway client (Cash In). OAuth2 client_credentials + mTLS.
// Docs: https://docs.versell.com.br
//
// Base URL (Cash In):  https://api.pix.basspago.com.br
//   POST /oauth/token          — OAuth2 (x-www-form-urlencoded), token TTL 300s
//   PUT  /cob/{txid}           — cria cobrança com txid definido por nós
//   GET  /cob/{txid}           — consulta cobrança
//   PUT  /webhook/{chave}      — registra a URL de webhook da chave PIX
//
// Env obrigatórias (ver .env.example):
//   VERSELL_CLIENT_ID
//   VERSELL_CLIENT_SECRET
//   VERSELL_PIX_KEY            — chave PIX que recebe as cobranças
//   VERSELL_CERT_PATH + VERSELL_KEY_PATH   (ou VERSELL_PFX_PATH + VERSELL_PFX_PASSWORD)
// Opcionais:
//   VERSELL_BASE_URL           — default https://api.pix.basspago.com.br
//   VERSELL_CA_PATH            — CA custom, se a Versell exigir
//
// SEGURANÇA: nada aqui pode ser exposto ao frontend. Certificados são lidos do
// disco no servidor; secrets nunca entram em log (ver redact()).

import https from 'node:https'
import fs from 'node:fs'
import { URL } from 'node:url'

const DEFAULT_BASE_URL = 'https://api.pix.basspago.com.br'

// Token TTL da Versell é 300s e o endpoint de token tem rate limit de
// 10 req/min — por isso o cache é obrigatório, não otimização.
const TOKEN_SAFETY_WINDOW_MS = 30_000   // renova 30s antes de expirar
const REQUEST_TIMEOUT_MS     = 20_000

export class VersellError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus?: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'VersellError'
  }
}

// ── Configuração ───────────────────────────────────────────────────────────

interface VersellConfig {
  baseUrl:      string
  clientId:     string
  clientSecret: string
  pixKey:       string
  tls:          { cert?: Buffer; key?: Buffer; pfx?: Buffer; passphrase?: string; ca?: Buffer }
}

// Cache do material TLS — evita ler o disco a cada request.
let cachedTls: VersellConfig['tls'] | null = null

function readTlsMaterial(): VersellConfig['tls'] {
  if (cachedTls) return cachedTls

  const certPath = process.env.VERSELL_CERT_PATH
  const keyPath  = process.env.VERSELL_KEY_PATH
  const pfxPath  = process.env.VERSELL_PFX_PATH
  const caPath   = process.env.VERSELL_CA_PATH

  const tls: VersellConfig['tls'] = {}
  try {
    if (pfxPath) {
      tls.pfx        = fs.readFileSync(pfxPath)
      tls.passphrase = process.env.VERSELL_PFX_PASSWORD || undefined
    } else if (certPath && keyPath) {
      tls.cert = fs.readFileSync(certPath)
      tls.key  = fs.readFileSync(keyPath)
    } else {
      throw new VersellError(
        'Certificado mTLS não configurado (defina VERSELL_CERT_PATH+VERSELL_KEY_PATH ou VERSELL_PFX_PATH)',
        'VERSELL_NOT_CONFIGURED',
      )
    }
    if (caPath) tls.ca = fs.readFileSync(caPath)
  } catch (err: any) {
    if (err instanceof VersellError) throw err
    // Path errado / permissão — mensagem sem vazar conteúdo do arquivo.
    throw new VersellError(
      `Falha ao ler certificado mTLS: ${err?.code ?? 'ERR'}`,
      'VERSELL_CERT_READ_FAILED',
    )
  }

  cachedTls = tls
  return tls
}

function readConfig(): VersellConfig {
  const baseUrl      = (process.env.VERSELL_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const clientId     = process.env.VERSELL_CLIENT_ID
  const clientSecret = process.env.VERSELL_CLIENT_SECRET
  const pixKey       = process.env.VERSELL_PIX_KEY

  if (!clientId || !clientSecret || !pixKey) {
    throw new VersellError(
      'Credenciais Versell ausentes (VERSELL_CLIENT_ID / VERSELL_CLIENT_SECRET / VERSELL_PIX_KEY)',
      'VERSELL_NOT_CONFIGURED',
    )
  }
  return { baseUrl, clientId, clientSecret, pixKey, tls: readTlsMaterial() }
}

/** True se TODAS as credenciais + certificado estiverem presentes. Não lança. */
export function isConfigured(): boolean {
  try { readConfig(); return true } catch { return false }
}

// ── HTTP com mTLS ──────────────────────────────────────────────────────────
// `fetch` global do Node não aceita cert/key por request sem um dispatcher do
// undici (que não é dependência do projeto). https.request nativo suporta
// mTLS direto e não adiciona nenhuma dependência nova.

interface HttpResult { status: number; body: string }

function httpsRequest(
  method:  'GET' | 'POST' | 'PUT',
  url:     string,
  headers: Record<string, string>,
  body:    string | null,
  tls:     VersellConfig['tls'],
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port:     u.port || 443,
        path:     u.pathname + u.search,
        headers:  body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers,
        cert:       tls.cert,
        key:        tls.key,
        pfx:        tls.pfx,
        passphrase: tls.passphrase,
        ca:         tls.ca,
        timeout:    REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body:   Buffer.concat(chunks).toString('utf8'),
        }))
      },
    )

    req.on('timeout', () => {
      req.destroy()
      reject(new VersellError('Timeout na comunicação com a Versell', 'VERSELL_TIMEOUT'))
    })
    req.on('error', (err: any) => {
      // Erros de TLS/handshake viram código próprio pra o admin diagnosticar.
      // UNABLE_TO_VERIFY_LEAF_SIGNATURE / SELF_SIGNED_* aparecem quando a CA
      // da Versell (onz.software, privada) não está em VERSELL_CA_PATH — o
      // servidor deles não envia a cadeia completa no handshake.
      const code = String(err?.code ?? '')
      const isTls = code.includes('CERT') || code.includes('SSL') || code === 'EPROTO'
                 || code.includes('VERIFY') || code.includes('SELF_SIGNED')
                 || code.includes('CHAIN')
      if (isTls) {
        reject(new VersellError(
          `Falha de mTLS/TLS: ${code}` +
          (code.includes('VERIFY') || code.includes('SELF_SIGNED')
            ? ' — configure VERSELL_CA_PATH com a CA da Versell (onz.software)'
            : ''),
          'VERSELL_MTLS_FAILED',
        ))
      } else {
        reject(new VersellError(`Falha de rede: ${code || 'unknown'}`, 'VERSELL_NETWORK_ERROR'))
      }
    })

    if (body) req.write(body)
    req.end()
  })
}

/** Extrai a mensagem de erro RFC 7807 da Versell sem vazar dados sensíveis. */
function parseApiError(status: number, rawBody: string): VersellError {
  let detail = ''
  try {
    const j = JSON.parse(rawBody)
    detail = [j?.title, j?.detail].filter(Boolean).join(' — ')
    if (Array.isArray(j?.violacoes) && j.violacoes.length) {
      detail += ' | ' + j.violacoes.map((v: any) => `${v?.propriedade}: ${v?.razao}`).join('; ')
    }
  } catch {
    detail = rawBody.slice(0, 200)
  }

  const code =
    status === 401 ? 'VERSELL_UNAUTHORIZED' :
    status === 403 ? 'VERSELL_FORBIDDEN'    :   // mTLS ausente/ inválido ou escopo
    status === 404 ? 'VERSELL_NOT_FOUND'    :
    status === 409 ? 'VERSELL_CONFLICT'     :   // txid já existe
    status === 429 ? 'VERSELL_RATE_LIMITED' :
    status >= 500  ? 'VERSELL_SERVER_ERROR' :
                     'VERSELL_REQUEST_FAILED'
  return new VersellError(`Versell HTTP ${status}`, code, status, detail.slice(0, 400))
}

// ── OAuth2 (token cacheado — TTL 300s, rate limit 10/min) ──────────────────

let cachedToken:  string | null = null
let cachedExpiry: number        = 0
// Evita "thundering herd": vários depósitos simultâneos compartilham 1 fetch.
let inFlightToken: Promise<string> | null = null

async function fetchAccessToken(): Promise<string> {
  const cfg  = readConfig()
  const form = new URLSearchParams({
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type:    'client_credentials',
  }).toString()

  const res = await httpsRequest(
    'POST',
    `${cfg.baseUrl}/oauth/token`,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    form,
    cfg.tls,
  )

  // A Versell responde 201 Created (não 200) no /oauth/token — aceitamos
  // qualquer 2xx. Restringir a 200 fazia toda cobrança falhar com
  // VERSELL_REQUEST_FAILED mesmo com a autenticação bem-sucedida.
  if (res.status < 200 || res.status >= 300) {
    const err = parseApiError(res.status, res.body)
    console.error(`[VERSELL] Authentication error — HTTP ${res.status} (${err.code})`)
    throw err
  }

  let json: any
  try { json = JSON.parse(res.body) } catch {
    throw new VersellError('Resposta de token inválida', 'VERSELL_AUTH_INVALID_RESPONSE')
  }
  if (!json?.access_token) {
    throw new VersellError('Resposta de token sem access_token', 'VERSELL_AUTH_INVALID_RESPONSE')
  }

  const expiresInSec = Number(json.expires_in) || 300
  cachedToken  = json.access_token
  cachedExpiry = Date.now() + expiresInSec * 1000
  return cachedToken as string
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedExpiry - Date.now() > TOKEN_SAFETY_WINDOW_MS) return cachedToken
  if (inFlightToken) return inFlightToken

  inFlightToken = fetchAccessToken().finally(() => { inFlightToken = null })
  return inFlightToken
}

/** Limpa o token em cache — usado no retry após 401. */
function invalidateToken(): void {
  cachedToken  = null
  cachedExpiry = 0
}

/**
 * Chamada autenticada com retry automático UMA vez em 401 (token expirado
 * entre o cache e o uso — janela de 300s é curta).
 */
async function authedRequest(
  method: 'GET' | 'PUT',
  path:   string,
  body:   unknown | null,
): Promise<any> {
  const cfg = readConfig()
  const payload = body ? JSON.stringify(body) : null

  const doCall = async (): Promise<HttpResult> => {
    const token = await getAccessToken()
    return httpsRequest(
      method,
      `${cfg.baseUrl}${path}`,
      { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      payload,
      cfg.tls,
    )
  }

  let res = await doCall()
  if (res.status === 401) {
    invalidateToken()
    res = await doCall()
  }

  if (res.status < 200 || res.status >= 300) throw parseApiError(res.status, res.body)

  try { return JSON.parse(res.body) } catch {
    throw new VersellError('Resposta JSON inválida', 'VERSELL_INVALID_RESPONSE')
  }
}

// ── Cash In: criar cobrança PIX ────────────────────────────────────────────

export interface VersellChargeInput {
  /** txid 26–35 chars [a-zA-Z0-9], único e definido por nós (reconciliação). */
  txid:           string
  /** Valor em BRL como string com 2 casas ("10.00") — NUNCA float. */
  amount:         string
  expiresInSec?:  number
  payerDocument?: string   // CPF só dígitos
  payerName?:     string
  description?:   string   // solicitacaoPagador (máx 140)
}

export interface VersellChargeResponse {
  txid:          string
  pixCopiaECola: string   // BR-Code (mesmo papel do `qrcode` da BSPay)
  status:        string   // "ATIVA"
  location:      string | null
  raw:           any
}

/** Valida o txid contra a regra da Versell/BACEN antes de gastar uma chamada. */
export function isValidTxid(txid: string): boolean {
  return /^[a-zA-Z0-9]{26,35}$/.test(txid)
}

export async function createCharge(input: VersellChargeInput): Promise<VersellChargeResponse> {
  const cfg = readConfig()

  if (!isValidTxid(input.txid)) {
    throw new VersellError(`txid fora do padrão (26-35 alfanuméricos)`, 'VERSELL_INVALID_TXID')
  }
  if (!/^\d+\.\d{2}$/.test(input.amount) || Number(input.amount) <= 0) {
    throw new VersellError('Valor inválido para cobrança', 'VERSELL_INVALID_AMOUNT')
  }

  const body: Record<string, unknown> = {
    calendario: { expiracao: input.expiresInSec ?? 3600 },
    valor:      { original: input.amount },
    chave:      cfg.pixKey,
  }
  if (input.payerDocument) {
    body.devedor = {
      cpf:  input.payerDocument,
      ...(input.payerName ? { nome: input.payerName } : {}),
    }
  }
  if (input.description) body.solicitacaoPagador = input.description.slice(0, 140)

  console.log(`[VERSELL] Creating PIX charge — txid: ${input.txid} amount: ${input.amount}`)

  // PUT /cob/{txid} — nós definimos o txid, então a reconciliação do webhook
  // não depende de guardar o id devolvido pela API.
  const json = await authedRequest('PUT', `/cob/${encodeURIComponent(input.txid)}`, body)

  const pixCopiaECola = json?.pixCopiaECola ?? json?.pixCopiaCola ?? null
  if (!pixCopiaECola) {
    throw new VersellError('Resposta sem pixCopiaECola', 'VERSELL_CHARGE_INVALID_RESPONSE')
  }

  const txid = json?.txid ?? input.txid
  console.log(`[VERSELL] Charge created - txid: ${txid} status: ${json?.status ?? '?'}`)

  return {
    txid,
    pixCopiaECola,
    status:   json?.status ?? 'ATIVA',
    location: json?.location ?? json?.loc?.location ?? null,
    raw:      json,
  }
}

/** Consulta uma cobrança (usado para conferência manual / conciliação). */
export async function getCharge(txid: string): Promise<any> {
  return authedRequest('GET', `/cob/${encodeURIComponent(txid)}`, null)
}

/**
 * Registra a URL de webhook para a chave PIX configurada.
 *
 * ATENÇÃO (doc oficial): a Versell ACRESCENTA "/pix" ao final da URL
 * registrada. Registrando ".../webhooks/versell/<secret>", as notificações
 * chegam em ".../webhooks/versell/<secret>/pix" — nossa rota aceita ambos.
 */
export async function registerWebhook(webhookUrl: string): Promise<any> {
  const cfg = readConfig()
  return authedRequest('PUT', `/webhook/${encodeURIComponent(cfg.pixKey)}`, { webhookUrl })
}
