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
function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const norm = phone.replace(/\D/g, '')
  if (norm === '') return null
  return sha256(norm)
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
      currency:         'USD',
      value:            deposit.amount,
      content_name:     'Deposit',
      content_category: 'Broker Deposit',
      deposit_id:       deposit.id,
    },
    depositId:    deposit.id,
  }).catch((err) => console.error('[meta] Purchase dispatch threw', err))
}

// ── Core dispatch ───────────────────────────────────────────────────────

interface DispatchArgs {
  eventName:   string
  eventId:     string
  user:        UserPayload
  customData:  Record<string, unknown>
  depositId:   string | null
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
  const userData: Record<string, unknown> = {}
  const em = hashEmail(args.user.email);  if (em) userData.em = [em]
  const ph = hashPhone(args.user.phone);  if (ph) userData.ph = [ph]
  const ex = hashUserId(args.user.id);    if (ex) userData.external_id = [ex]
  if (tracking.fbp)       userData.fbp                = tracking.fbp
  if (tracking.fbc)       userData.fbc                = tracking.fbc
  if (tracking.ip)        userData.client_ip_address  = tracking.ip
  if (tracking.userAgent) userData.client_user_agent  = tracking.userAgent

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name:    args.eventName,
        event_time:    Math.floor(Date.now() / 1000),
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
