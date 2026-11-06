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

// ── Timeouts ───────────────────────────────────────────────────────────────
// Medidos em producao (06/11/2026): um deposito saudavel leva ~3,9s ponta a
// ponta. Das 71 falhas historicas, 43 eram timeout puro — 20 batendo exatos
// 10,0s (o limite antigo do token) e 23 em ~15,0s (o limite antigo do cashin).
// A BSPay revende a MagenPay, entao ha um salto a mais na cadeia e as
// oscilacoes sao grandes. Preferimos o usuario esperar mais a ver erro: ele
// ja esperava 15s e levava "falhou" do mesmo jeito.
const TOKEN_TIMEOUT_MS  = 20_000
const CASHIN_TIMEOUT_MS = 25_000

// ── Token cache (process-wide) ─────────────────────────────────────────────
// A renovacao antiga rodava DENTRO do request do usuario: a primeira pessoa a
// depositar depois da expiracao pagava o custo do OAuth, e se ele travasse o
// deposito dela morria (20 das 71 falhas). Agora renovamos 5 min antes do
// vencimento em background e devolvemos o token atual na hora — ninguem
// espera por OAuth a nao ser que o token ja esteja praticamente morto.
const REFRESH_AHEAD_MS = 5 * 60_000
const HARD_EXPIRY_MS   = 30_000

let cachedToken:  string | null = null
let cachedExpiry: number        = 0  // epoch ms
// Single-flight: depositos simultaneos compartilham uma renovacao so.
let inflightRefresh: Promise<string> | null = null

function readConfig() {
  const baseUrl     = (process.env.BSPAY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const clientId    = process.env.BSPAY_CLIENT_ID
  const clientSecret= process.env.BSPAY_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('BSPAY_NOT_CONFIGURED')
  return { baseUrl, clientId, clientSecret }
}

/** Timeout do AbortSignal chega como DOMException name='TimeoutError'. */
function isTransient(err: any): boolean {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return true
  // Erro de rede (DNS, conexao recusada, socket cortado).
  if (err?.name === 'TypeError' && /fetch/i.test(err?.message ?? '')) return true
  // 5xx do lado deles vale nova tentativa; 4xx (credencial errada) nao.
  return /^BSPAY_AUTH_FAILED:5\d\d/.test(err?.message ?? '')
}

async function requestAccessToken(): Promise<{ token: string; expiresIn: number }> {
  const { baseUrl, clientId, clientSecret } = readConfig()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(`${baseUrl}/v2/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`BSPAY_AUTH_FAILED:${res.status}:${body.slice(0, 200)}`)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  if (!json.access_token) throw new Error('BSPAY_AUTH_INVALID_RESPONSE')
  return { token: json.access_token, expiresIn: json.expires_in ?? 3600 }
}

/**
 * Token novo, com UMA tentativa extra em falha transitoria.
 *
 * Retry aqui e seguro porque /oauth/token e idempotente: pedir dois tokens
 * nao cobra nada de ninguem. Isso NAO vale pro cashin, que cria cobranca de
 * verdade — ver o comentario em createCashin.
 */
async function fetchAccessToken(): Promise<{ token: string; expiresIn: number }> {
  try {
    return await requestAccessToken()
  } catch (err: any) {
    if (!isTransient(err)) throw err
    console.warn(`[BSPAY] token falhou (${err?.name ?? err?.message}) — tentando mais uma vez`)
    await new Promise((r) => setTimeout(r, 500))
    return requestAccessToken()
  }
}

function refreshToken(): Promise<string> {
  if (inflightRefresh) return inflightRefresh
  inflightRefresh = (async () => {
    try {
      const { token, expiresIn } = await fetchAccessToken()
      cachedToken  = token
      cachedExpiry = Date.now() + expiresIn * 1000
      return token
    } finally {
      inflightRefresh = null
    }
  })()
  return inflightRefresh
}

async function getAccessToken(): Promise<string> {
  const restante = cachedExpiry - Date.now()

  // Token folgado — usa direto.
  if (cachedToken && restante > REFRESH_AHEAD_MS) return cachedToken

  // Perto de vencer mas ainda valido: renova em background e devolve o atual,
  // pro usuario nao esperar pelo OAuth.
  if (cachedToken && restante > HARD_EXPIRY_MS) {
    refreshToken().catch((err) => {
      console.error('[BSPAY] renovacao de token em background falhou:', err?.message ?? err)
    })
    return cachedToken
  }

  // Sem token, ou vencendo agora: nao tem como escapar da espera.
  return refreshToken()
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

/**
 * Cria a cobranca PIX.
 *
 * SEM RETRY, de proposito. Em 06/11/2026 encontramos duas cobrancas de R$100
 * no painel da BSPay (2137c69d7f…, 8e02118251…) sem par no nosso banco: a
 * chamada estourou o timeout do nosso lado, mas a BSPay processou o pedido
 * 3-4 min depois e gerou o QR assim mesmo. Ou seja, timeout aqui NAO quer
 * dizer "nao criou" — quer dizer "nao sei". Repetir o POST geraria duas
 * cobrancas reais pro mesmo deposito.
 *
 * So da pra ligar retry depois que a BSPay confirmar por escrito que
 * deduplica pelo external_id que mandamos.
 */
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
    signal: AbortSignal.timeout(CASHIN_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(CASHIN_TIMEOUT_MS),
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

/**
 * Pede um token só pra conferir se a credencial presta. Usado pelo botão
 * "Testar credenciais" do admin.
 *
 * Idempotente e sem efeito financeiro: emitir token não cria nem move
 * dinheiro. Lança o mesmo erro de sempre (BSPAY_AUTH_FAILED:<status>) pra
 * quem chamar classificar.
 */
export async function pingAuth(): Promise<void> {
  await fetchAccessToken()
}
