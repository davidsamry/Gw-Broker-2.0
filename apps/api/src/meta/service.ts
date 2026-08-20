// Meta Conversions API sender — fires CompleteRegistration + Purchase
// events server-side to https://graph.facebook.com/v23.0/{pixelId}/events.
//
// Design rules:
//   - Fire-and-forget. Meta failure NEVER blocks register/deposit flow.
//   - Config loaded fresh from meta_pixel_settings per send so admin
//     toggling Pixel off takes effect immediately, zero restart.
//   - Dedupe via meta_events_log + the `event_id` Meta uses for its own
//     dedupe with the browser Pixel — same event_id format both sides.
//   - PII (email, phone, user_id) hashed with SHA-256 per Meta spec.
//   - Token is read from DB only, NEVER from env vars, NEVER logged in full.

import crypto from 'node:crypto'
import { prisma } from '../prisma.js'
import { getMetaPixelSettings, maskToken } from './settings.js'
import { getUserTracking } from './tracking.js'

const META_API_VERSION = 'v23.0'
const TIMEOUT_MS       = 10_000   // Meta is fast; if it's slow, we don't wait

// ── Hashing helpers (Meta spec — SHA-256 lowercase hex) ────────────────

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// Email: trim + lowercase BEFORE hash.
function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const norm = email.trim().toLowerCase()
  if (norm === '') return null
  return sha256(norm)
}

// Phone: digits only BEFORE hash (Meta wants international with no +).
//
// O usuário digita no formato brasileiro — "(11) 98765-4321" vira
// "11987654321". A Meta exige o CÓDIGO DO PAÍS junto, senão o match falha.
// Prefixamos 55 quando o número tem 10 ou 11 dígitos (fixo/celular BR) e
// ainda não começa com 55. Números que já vêm internacionais passam intactos.
function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  let norm = phone.replace(/\D/g, '')
  if (norm === '') return null
  if ((norm.length === 10 || norm.length === 11) && !norm.startsWith('55')) {
    norm = `55${norm}`
  }
  return sha256(norm)
}

// Nome (fn/ln): minúsculas, sem acentos, só letras. A Meta compara contra o
// cadastro do Facebook normalizado da mesma forma.
function hashName(name: string | null | undefined): string | null {
  if (!name) return null
  const norm = name.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .replace(/[^a-z]/g, '')
  return norm === '' ? null : sha256(norm)
}

// Cidade (ct): minúsculas, sem acentos, sem espaços nem pontuação.
// "São Paulo" → "saopaulo"
function hashCity(city: string | null | undefined): string | null {
  if (!city) return null
  const norm = city.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
  return norm === '' ? null : sha256(norm)
}

// Estado (st): sigla de 2 letras minúsculas. Aceita "SP" ou "São Paulo"
// (nesse caso só normaliza; se não couber em 2 letras, envia como veio).
function hashState(state: string | null | undefined): string | null {
  if (!state) return null
  const norm = state.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
  return norm === '' ? null : sha256(norm)
}

// CEP (zp): só dígitos. "01310-100" → "01310100"
function hashZip(zip: string | null | undefined): string | null {
  if (!zip) return null
  const norm = zip.replace(/\D/g, '')
  return norm === '' ? null : sha256(norm)
}

// País (country): código ISO de 2 letras, minúsculo. O cadastro guarda o
// nome por extenso ("Brasil"), então mapeamos os do seletor de países.
const ISO_POR_PAIS: Record<string, string> = {
  brasil: 'br', portugal: 'pt', argentina: 'ar', chile: 'cl',
  colombia: 'co', mexico: 'mx', peru: 'pe',
  'estados unidos': 'us', espanha: 'es',
}
function hashCountry(country: string | null | undefined): string | null {
  if (!country) return null
  const bruto = country.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
  // Já veio como sigla?
  const iso = bruto.length === 2 ? bruto : ISO_POR_PAIS[bruto]
  return iso ? sha256(iso) : null
}

// User ID: hash so we can match anonymous browser sessions to the same
// person later via Pixel `external_id` if Pixel JS is added in the future.
function hashUserId(userId: string | null | undefined): string | null {
  if (!userId) return null
  return sha256(String(userId))
}

// ── Dedupe ─────────────────────────────────────────────────────────────

/** True iff `eventId` already shipped successfully. */
async function alreadySent(eventId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM meta_events_log
    WHERE "eventId" = ${eventId} AND success = TRUE
    LIMIT 1
  `
  return rows.length > 0
}

// ── Public entry points ─────────────────────────────────────────────────

export interface UserPayload {
  id:    string
  email: string | null
  phone?: string | null
  // Advanced matching — quanto mais campos, melhor a atribuição da Meta.
  // Todos opcionais: o que estiver vazio simplesmente não é enviado.
  firstName?: string | null
  lastName?:  string | null
  city?:      string | null
  state?:     string | null
  zip?:       string | null
  country?:   string | null
}

/**
 * CompleteRegistration — fired once per new user, right after their row
 * lands in the DB. Idempotent: if called twice for the same user (test
 * harnesses, re-registration races), the second call no-ops via dedupe.
 */
export function sendCompleteRegistrationAsync(user: UserPayload): void {
  const eventId = `registration_${user.id}_${Math.floor(Date.now() / 1000)}`
  void dispatch({
    eventName:    'CompleteRegistration',
    eventId,
    user,
    customData:   {},
    depositId:    null,
  }).catch((err) => console.error('[meta] CompleteRegistration dispatch threw', err))
}

export interface DepositPayload {
  id:     string
  amount: number
}

/**
 * Purchase — fired once per CONFIRMED deposit. Caller (deposits/service)
 * is responsible for only invoking this on a status transition into
 * PAID — we don't re-check status here, but dedupe on event_id stops a
 * duplicate webhook from posting twice anyway.
 */
export function sendPurchaseAsync(user: UserPayload, deposit: DepositPayload): void {
  const eventId = `purchase_${deposit.id}_${user.id}`
  void dispatch({
    eventName:    'Purchase',
    eventId,
    user,
    customData: {
      // BRL because deposit.amount is the PIX value in reais (BSPay is
      // Brazil-only and admin caps are configured in R$ on
      // /admin/configuracoes). Sending it as 'USD' would make Meta value
      // the deposit at ~5x its actual size, inflating ROAS/CPM in every
      // campaign report.
      currency:         'BRL',
      value:            deposit.amount,
      content_name:     'Deposit',
      content_category: 'Broker Deposit',
      deposit_id:       deposit.id,
    },
    depositId:    deposit.id,
  }).catch((err) => console.error('[meta] Purchase dispatch threw', err))
}

/**
 * Monta o bloco `user_data` do evento (advanced matching).
 *
 * Cada campo entra como array de 1 item — formato que a Meta espera — e só
 * quando existe: mandar chave vazia não ajuda no match e ainda polui o
 * payload. Os campos de PII vão com SHA-256; fbp/fbc/IP/user-agent vão em
 * texto puro, porque a Meta os usa como identificadores de sessão.
 *
 * Exportada para ser verificável isoladamente — o hash é silencioso: se a
 * normalização estiver errada, a Meta simplesmente não casa o usuário e
 * nenhum erro aparece.
 */
export function buildUserData(
  user: UserPayload,
  tracking: { fbp?: string | null; fbc?: string | null; ip?: string | null; userAgent?: string | null },
): Record<string, unknown> {
  const userData: Record<string, unknown> = {}
  const em = hashEmail(user.email);        if (em) userData.em          = [em]
  const ph = hashPhone(user.phone);        if (ph) userData.ph          = [ph]
  const ex = hashUserId(user.id);          if (ex) userData.external_id = [ex]
  const fn = hashName(user.firstName);     if (fn) userData.fn          = [fn]
  const ln = hashName(user.lastName);      if (ln) userData.ln          = [ln]
  const ct = hashCity(user.city);          if (ct) userData.ct          = [ct]
  const st = hashState(user.state);        if (st) userData.st          = [st]
  const zp = hashZip(user.zip);            if (zp) userData.zp          = [zp]
  const co = hashCountry(user.country);    if (co) userData.country     = [co]
  if (tracking.fbp)       userData.fbp               = tracking.fbp
  if (tracking.fbc)       userData.fbc               = tracking.fbc
  if (tracking.ip)        userData.client_ip_address = tracking.ip
  if (tracking.userAgent) userData.client_user_agent = tracking.userAgent
  return userData
}

// ── Backfill (reenvio retroativo) ───────────────────────────────────────
//
// Usado quando o Pixel ficou desligado e eventos deixaram de ser enviados.
//
// LIMITE DA META: event_time só pode ter até 7 dias. Eventos mais antigos
// fazem a requisição INTEIRA ser rejeitada (a doc é explícita: "we return an
// error for the entire request and process no events"). Por isso a janela é
// checada aqui, evento a evento — nada fora dela chega a ser tentado.
//
// Usamos 6,5 dias como corte para ter folga: entre montar a lista e a
// requisição chegar à Meta passam alguns segundos/minutos.
const BACKFILL_MAX_AGE_SEC = Math.floor(6.5 * 24 * 60 * 60)

export function dentroDaJanelaMeta(quando: Date): boolean {
  const idadeSec = (Date.now() - quando.getTime()) / 1000
  return idadeSec >= 0 && idadeSec <= BACKFILL_MAX_AGE_SEC
}

export type ResultadoBackfill = 'enviado' | 'duplicado' | 'fora-da-janela' | 'falhou' | 'desligado'

/** Reenvia um CompleteRegistration com o horário ORIGINAL do cadastro. */
export async function backfillRegistration(
  user: UserPayload, registradoEm: Date,
): Promise<ResultadoBackfill> {
  if (!dentroDaJanelaMeta(registradoEm)) return 'fora-da-janela'
  const eventTime = Math.floor(registradoEm.getTime() / 1000)
  // event_id determinístico (com o horário original) — se o backfill rodar
  // duas vezes, o dedupe do meta_events_log barra a segunda.
  return dispatchBackfill({
    eventName: 'CompleteRegistration',
    eventId:   `registration_${user.id}_${eventTime}`,
    user, customData: {}, depositId: null, eventTime,
  })
}

/** Reenvia um Purchase com o horário ORIGINAL da confirmação do depósito. */
export async function backfillPurchase(
  user: UserPayload, deposit: DepositPayload, pagoEm: Date,
): Promise<ResultadoBackfill> {
  if (!dentroDaJanelaMeta(pagoEm)) return 'fora-da-janela'
  return dispatchBackfill({
    eventName: 'Purchase',
    eventId:   `purchase_${deposit.id}_${user.id}`,   // já é determinístico
    user,
    customData: {
      currency: 'BRL', value: deposit.amount,
      content_name: 'Deposit', content_category: 'Broker Deposit',
      deposit_id: deposit.id,
    },
    depositId: deposit.id,
    eventTime: Math.floor(pagoEm.getTime() / 1000),
  })
}

/** Versão do dispatch que AGUARDA e informa o resultado (o normal é fire-and-forget). */
async function dispatchBackfill(args: DispatchArgs): Promise<ResultadoBackfill> {
  const cfg = await getMetaPixelSettings()
  if (!cfg.enabled || !cfg.pixelId?.trim() || !cfg.pixelToken?.trim()) return 'desligado'
  if (await alreadySent(args.eventId)) return 'duplicado'
  try {
    await dispatch(args)
    return (await alreadySent(args.eventId)) ? 'enviado' : 'falhou'
  } catch {
    return 'falhou'
  }
}

// ── Core dispatch ───────────────────────────────────────────────────────

interface DispatchArgs {
  eventName:   string
  eventId:     string
  user:        UserPayload
  customData:  Record<string, unknown>
  depositId:   string | null
  /**
   * Horário REAL do evento (epoch em segundos). Omitido = agora, que é o
   * caso normal (evento disparado no instante em que acontece).
   *
   * Usado pelo backfill: a Meta REJEITA o lote inteiro se algum event_time
   * tiver mais de 7 dias, então o horário original importa — e eventos
   * fora da janela nem devem ser tentados.
   */
  eventTime?:  number
}

async function dispatch(args: DispatchArgs): Promise<void> {
  // 1. Read settings fresh. If Pixel is disabled or unconfigured,
  //    silently no-op — admin will see no events at all, which is
  //    correct: the integration is off.
  const cfg = await getMetaPixelSettings()
  if (!cfg.enabled)                                  return
  if (!cfg.pixelId    || cfg.pixelId.trim() === '')  return
  if (!cfg.pixelToken || cfg.pixelToken.trim() === '') return

  // 2. Dedupe BEFORE building the payload — cheap query, avoids
  //    hashing PII for events we won't send.
  if (await alreadySent(args.eventId)) {
    console.log(`[meta] dedup skip event_id=${args.eventId} (already sent)`)
    return
  }

  // 3. Load tracking attribution captured at register.
  const tracking = await getUserTracking(args.user.id)

  // 4. Build the payload per Meta v23 spec.
  const userData = buildUserData(args.user, tracking)

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name:    args.eventName,
        event_time:    args.eventTime ?? Math.floor(Date.now() / 1000),
        event_id:      args.eventId,
        action_source: 'website',
        user_data:     userData,
        ...(Object.keys(args.customData).length ? { custom_data: args.customData } : {}),
      },
    ],
  }
  // test_event_code only when configured — Meta routes these to the
  // Test Events tab instead of Live, so live KPIs stay clean.
  if (cfg.testEventCode && cfg.testEventCode.trim() !== '') {
    (payload as any).test_event_code = cfg.testEventCode.trim()
  }

  // 5. POST. Wrap entire fetch in try/catch — sender NEVER throws.
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(cfg.pixelId.trim())}/events?access_token=${encodeURIComponent(cfg.pixelToken.trim())}`
  let response: any = null
  let success      = false
  let errorMessage: string | null = null
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    })
    const bodyTxt = await res.text().catch(() => '')
    try { response = bodyTxt ? JSON.parse(bodyTxt) : null } catch { response = { raw: bodyTxt.slice(0, 500) } }
    success = res.ok
    if (!res.ok) errorMessage = `HTTP ${res.status} ${res.statusText}`
  } catch (err: any) {
    errorMessage = err?.name === 'TimeoutError' ? 'TIMEOUT' : (err?.message ?? String(err))
  }

  // 6. Log to meta_events_log — always, success or failure. Use INSERT
  //    with the original payload (token-free; we strip it from the URL
  //    before logging via the redacted-payload). The payload above is
  //    the request body, which doesn't contain the token at all.
  try {
    await prisma.$executeRaw`
      INSERT INTO meta_events_log
        (id, "eventName", "eventId", "userId", "depositId", payload, response, success, "errorMessage", "createdAt")
      VALUES (
        gen_random_uuid()::text, ${args.eventName}, ${args.eventId},
        ${args.user.id}, ${args.depositId},
        ${JSON.stringify(payload)}::jsonb,
        ${response ? JSON.stringify(response) : null}::jsonb,
        ${success}, ${errorMessage}, NOW()
      )
    `
  } catch (logErr) {
    console.error('[meta] events_log insert failed (non-fatal)', logErr)
  }

  // 7. Console line — mask token even though it's not in the payload,
  //    in case a future refactor exposes it via URL or header by accident.
  console.log(
    `[meta] ${args.eventName} event_id=${args.eventId} pixel=${cfg.pixelId} ` +
    `token=${maskToken(cfg.pixelToken)} success=${success}` +
    (errorMessage ? ` err=${errorMessage}` : ''),
  )
}
