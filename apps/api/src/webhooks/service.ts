// Outbound webhook sender — fires registration / first deposit / subsequent
// deposit notifications to an external URL (e.g. TrackFlow) configured per
// event in /admin/webhooks.
//
// Design rules:
//   - Fire-and-forget. Webhook failure NEVER blocks the business flow
//     (user registration, deposit confirmation). Errors only log.
//   - Per-event config (URL + active) loaded fresh from DB on each fire;
//     the admin can toggle / change URL with zero restart.
//   - Retry: 3 attempts with exponential backoff (1s, 2s, 4s). Total
//     worst case ~7s before giving up — well under the 30s timeout per
//     attempt the spec requires.
//   - Timeout: 30s per attempt (AbortSignal.timeout) — matches TrackFlow
//     spec "Boas Práticas" item 2.
//   - Logging: every attempt + final outcome logs a structured line so
//     post-hoc auditing via grep is trivial.

import { prisma } from '../prisma.js'

// Canonical event keys — kept here (not in DB) so a typo in the admin UI
// can't accidentally create a fourth row. Service rejects unknown keys.
export type WebhookKey = 'REGISTRATION' | 'FIRST_DEPOSIT' | 'SUBSEQUENT_DEPOSIT'

export interface WebhookConfig {
  id:        string
  key:       WebhookKey
  url:       string
  active:    boolean
  createdAt: Date
  updatedAt: Date
}

// ── Config CRUD (admin) ──────────────────────────────────────────────────

export async function listWebhookConfigs(): Promise<WebhookConfig[]> {
  const rows = await prisma.$queryRaw<WebhookConfig[]>`
    SELECT id, key, url, active, "createdAt", "updatedAt"
    FROM webhook_configs
    ORDER BY key ASC
  `
  return rows
}

export async function getWebhookConfig(key: WebhookKey): Promise<WebhookConfig | null> {
  const rows = await prisma.$queryRaw<WebhookConfig[]>`
    SELECT id, key, url, active, "createdAt", "updatedAt"
    FROM webhook_configs WHERE key = ${key} LIMIT 1
  `
  return rows[0] ?? null
}

export async function updateWebhookConfig(
  key: WebhookKey,
  patch: { url?: string; active?: boolean },
): Promise<WebhookConfig | null> {
  // Build a defensive UPDATE — only touch what was passed. We could
  // template a single query with COALESCE but the explicit branches keep
  // it grepable.
  if (patch.url !== undefined && patch.active !== undefined) {
    await prisma.$executeRaw`
      UPDATE webhook_configs
      SET url = ${patch.url}, active = ${patch.active}, "updatedAt" = NOW()
      WHERE key = ${key}
    `
  } else if (patch.url !== undefined) {
    await prisma.$executeRaw`
      UPDATE webhook_configs SET url = ${patch.url}, "updatedAt" = NOW() WHERE key = ${key}
    `
  } else if (patch.active !== undefined) {
    await prisma.$executeRaw`
      UPDATE webhook_configs SET active = ${patch.active}, "updatedAt" = NOW() WHERE key = ${key}
    `
  }
  return getWebhookConfig(key)
}

// ── Sender (called from business flows) ──────────────────────────────────

const MAX_ATTEMPTS  = 3
const TIMEOUT_MS    = 30_000
const BACKOFF_MS    = [1_000, 2_000, 4_000]   // before attempt 2 / 3 / final

/**
 * Fire-and-forget webhook send. Looks up the config for `key`; if the
 * webhook is disabled or unconfigured, returns silently. Otherwise POSTs
 * the payload to the configured URL with retry + timeout. NEVER throws —
 * any error is logged and swallowed.
 */
export function sendWebhookAsync(key: WebhookKey, payload: Record<string, unknown>): void {
  void sendWebhook(key, payload).catch((err) => {
    console.error(`[webhook] ${key} dispatch threw (should never happen)`, err)
  })
}

async function sendWebhook(key: WebhookKey, payload: Record<string, unknown>): Promise<void> {
  let cfg: WebhookConfig | null
  try {
    cfg = await getWebhookConfig(key)
  } catch (err) {
    console.error(`[webhook] ${key} config lookup failed`, err)
    return
  }
  if (!cfg)                          return console.warn(`[webhook] ${key} config missing — skip`)
  if (!cfg.active)                   return                                  // silently off
  if (!cfg.url || cfg.url.trim() === '') {
    console.warn(`[webhook] ${key} active but URL empty — skip`)
    return
  }

  const url = cfg.url.trim()
  const body = JSON.stringify(payload)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal:  AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.ok) {
        console.log(`[webhook] ${key} ok attempt=${attempt} status=${res.status} url=${url}`)
        return
      }
      // Non-2xx: log + maybe retry. 4xx is a payload/auth issue — retry
      // won't help, so give up immediately. 5xx is transient — retry.
      console.warn(`[webhook] ${key} non-ok attempt=${attempt} status=${res.status} url=${url}`)
      if (res.status >= 400 && res.status < 500) {
        console.error(`[webhook] ${key} 4xx — giving up (payload likely invalid)`)
        return
      }
    } catch (err: any) {
      const name = err?.name ?? 'Error'
      console.warn(`[webhook] ${key} fetch failed attempt=${attempt} err=${name} msg=${err?.message ?? ''}`)
    }

    // If not the last attempt, wait the configured backoff before next try.
    if (attempt < MAX_ATTEMPTS) {
      const delay = BACKOFF_MS[attempt - 1] ?? 4_000
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  console.error(`[webhook] ${key} failed after ${MAX_ATTEMPTS} attempts url=${url}`)
}

// ── Convenience wrappers per event — same shape the TrackFlow spec
//    documents (value/event_name/email for deposits, event_name/email
//    for the registration variant). Callers don't construct payloads
//    by hand; one wrapper per business flow.

/** Registration — fired from auth/service.ts after a new user is created. */
export function sendRegistrationWebhook(email: string): void {
  sendWebhookAsync('REGISTRATION', {
    event_name: 'Registration',
    email,
  })
}

/** First deposit — fired from deposits/service.ts when the very first
 *  deposit for a user is confirmed. Payload matches TrackFlow's FTD spec. */
export function sendFirstDepositWebhook(email: string, value: number): void {
  sendWebhookAsync('FIRST_DEPOSIT', {
    value,
    event_name: 'FirstDeposit',
    email,
  })
}

/** Subsequent deposit — fired from the same confirm flow when the user
 *  already has at least one previous confirmed deposit. */
export function sendSubsequentDepositWebhook(email: string, value: number): void {
  sendWebhookAsync('SUBSEQUENT_DEPOSIT', {
    value,
    event_name: 'Deposit',
    email,
  })
}
