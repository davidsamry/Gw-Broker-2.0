// BSPay PIX gateway client. Wraps OAuth + cash-in endpoints.
// Docs: https://dev.bspay.co/introduction
//
// Required env:
//   BSPAY_CLIENT_ID      — OAuth client id
//   BSPAY_CLIENT_SECRET  — OAuth client secret
//   BSPAY_BASE_URL       — optional, defaults to https://api.bspay.co
//
// If any of the credentials are missing, every call throws
// BSPAY_NOT_CONFIGURED so the frontend can surface a clean error to the user
// (no fake QR codes, no silent failures).

const DEFAULT_BASE_URL = 'https://api.bspay.co'

// ── Token cache (process-wide, refreshed when within 60s of expiry) ────────
let cachedToken:  string | null = null
let cachedExpiry: number        = 0  // epoch ms

function readConfig() {
  const baseUrl     = (process.env.BSPAY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const clientId    = process.env.BSPAY_CLIENT_ID
  const clientSecret= process.env.BSPAY_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('BSPAY_NOT_CONFIGURED')
  return { baseUrl, clientId, clientSecret }
}

async function fetchAccessToken(): Promise<{ token: string; expiresIn: number }> {
  const { baseUrl, clientId, clientSecret } = readConfig()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(`${baseUrl}/v2/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`BSPAY_AUTH_FAILED:${res.status}:${body.slice(0, 200)}`)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  if (!json.access_token) throw new Error('BSPAY_AUTH_INVALID_RESPONSE')
  return { token: json.access_token, expiresIn: json.expires_in ?? 3600 }
}

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  // Refresh proactively 60s before actual expiry to avoid mid-request timeouts.
  if (cachedToken && cachedExpiry - now > 60_000) return cachedToken

  const { token, expiresIn } = await fetchAccessToken()
  cachedToken  = token
  cachedExpiry = now + expiresIn * 1000
  return token
}

// ── Cash-in (PIX deposit) ───────────────────────────────────────────────────

export interface CashinInput {
  amount:       number   // BRL, 2 decimal places
  externalId:   string   // our Deposit.id — used by webhook lookup
  postbackUrl:  string   // public HTTPS URL on our API
  // Payer identification — required by PIX since end-2024. Bare digits
  // (no mask). Name is the user's display name (used by some banks to
  // show "Pagar para X" on the payer's app).
  payerDocument?: string
  payerName?:     string
}

export interface CashinResponse {
  qrcode:      string   // BR-Code text (paste-and-pay)
  providerId:  string   // BSPay's transaction id (saved for audit / reconciliation)
  raw:         any      // full response for debugging
}

export async function createCashin(input: CashinInput): Promise<CashinResponse> {
  const { baseUrl } = readConfig()
  const token = await getAccessToken()

  const res = await fetch(`${baseUrl}/v2/transactions/cashin`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      amount:       input.amount,
      currency:     'BRL',
      external_id:  input.externalId,
      postback_url: input.postbackUrl,
      // Payer info — BSPay's schema follows the brcode/pixchargev2 spec.
      // Document = bare CPF (11 digits). Omitted when not supplied so
      // older deposits without CPF still go through.
      ...(input.payerDocument
        ? { payer: { document: input.payerDocument, name: input.payerName ?? undefined } }
        : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`BSPAY_CASHIN_FAILED:${res.status}:${body.slice(0, 400)}`)
  }

  const json = await res.json() as any
  // Response shape per docs:
  //   { data: { payment_info: { qrcode: "..." }, transaction_id: "..." } }
  // We're defensive about the exact path — providers sometimes shift field names.
  const qrcode     = json?.data?.payment_info?.qrcode ?? json?.data?.qrcode ?? json?.qrcode
  const providerId = json?.data?.transaction_id ?? json?.transaction_id ?? json?.data?.id ?? null

  if (!qrcode) throw new Error('BSPAY_CASHIN_INVALID_RESPONSE')
  return { qrcode, providerId, raw: json }
}

// ── Cash-in CRYPTO (USDT/BTC/etc deposit) ──────────────────────────────────
// Diferente do PIX:
//   - currency e' o ativo crypto ("USDT", "BTC", etc) — NAO "BRL"
//   - chain e' obrigatorio ("tron", "ethereum", "bsc")
//   - amount e' em CRYPTO (ex: 10.50 USDT) — BSPay NAO converte de BRL
//   - response retorna deposit_address (carteira) + expires_at
//
// Spec: https://dev.bspay.co/reference/cryptocurrencies

export interface CryptoCashinInput {
  amount:      number   // valor em CRYPTO (ex: 10.5 USDT)
  currency:    string   // "USDT" | "BTC" | "ETH" | etc
  chain:       string   // "tron" | "ethereum" | "bsc"
  externalId:  string   // nosso Deposit.id
  postbackUrl: string   // HTTPS publico
}

export interface CryptoCashinResponse {
  depositAddress: string         // carteira gerada pra esse pagamento
  expiresAt:      Date | null    // quando o address invalida
  providerId:     string | null  // transaction_id do BSPay
  raw:            any
}

export async function createCryptoCashin(input: CryptoCashinInput): Promise<CryptoCashinResponse> {
  const { baseUrl } = readConfig()
  const token = await getAccessToken()

  const res = await fetch(`${baseUrl}/v2/transactions/cashin`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      amount:       input.amount,
      currency:     input.currency,
      chain:        input.chain,
      external_id:  input.externalId,
      postback_url: input.postbackUrl,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`BSPAY_CRYPTO_CASHIN_FAILED:${res.status}:${body.slice(0, 400)}`)
  }

  const json = await res.json() as any
  // Response envelope: { success: true, data: { deposit_address, expires_at, transaction_id } }
  // Defensive: tentamos varios paths comuns.
  const data = json?.data ?? json
  const depositAddress = data?.deposit_address ?? data?.address ?? data?.payment_info?.address
  const expiresAtStr   = data?.expires_at ?? data?.expiresAt ?? null
  const providerId     = data?.transaction_id ?? data?.id ?? null

  if (!depositAddress) throw new Error('BSPAY_CRYPTO_CASHIN_INVALID_RESPONSE')

  return {
    depositAddress,
    expiresAt: expiresAtStr ? new Date(expiresAtStr) : null,
    providerId,
    raw: json,
  }
}

// ── Cotacao BRL -> USDT via Binance ────────────────────────────────────────
// BSPay nao converte BRL pra USDT automatico — user digita R$ X, calculamos
// USDT = X / rate. Usamos Binance USDTBRL spot price (fonte mais liquida).
// Cache de 30s — UI re-cota a cada gera nova cobranca.

let cachedBrlToUsdtRate:    number | null = null
let cachedBrlToUsdtFetchedAt: number = 0
const RATE_CACHE_TTL_MS = 30_000

export async function getBrlToUsdtRate(): Promise<number> {
  const now = Date.now()
  if (cachedBrlToUsdtRate && now - cachedBrlToUsdtFetchedAt < RATE_CACHE_TTL_MS) {
    return cachedBrlToUsdtRate
  }
  const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL', {
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) throw new Error('BINANCE_RATE_FETCH_FAILED')
  const json = await res.json() as { price: string }
  const rate = Number(json.price)
  if (!isFinite(rate) || rate <= 0) throw new Error('BINANCE_RATE_INVALID')
  cachedBrlToUsdtRate    = rate
  cachedBrlToUsdtFetchedAt = now
  return rate
}

// ── Health check ───────────────────────────────────────────────────────────
// Used to surface configuration errors early (e.g. on app boot).
export function isConfigured(): boolean {
  return !!(process.env.BSPAY_CLIENT_ID && process.env.BSPAY_CLIENT_SECRET)
}
