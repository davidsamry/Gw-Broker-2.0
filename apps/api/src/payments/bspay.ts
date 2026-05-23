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

// ── Health check ───────────────────────────────────────────────────────────
// Used to surface configuration errors early (e.g. on app boot).
export function isConfigured(): boolean {
  return !!(process.env.BSPAY_CLIENT_ID && process.env.BSPAY_CLIENT_SECRET)
}
