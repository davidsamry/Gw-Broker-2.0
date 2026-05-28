// Email service — single entry point for sending all transactional emails.
//
// Flow:
//   1. Look up the template by key in the email_templates table.
//   2. If template.active === false, no-op silently (admin can disable
//      a category without losing the body).
//   3. Render {{vars}} with provided context.
//   4. Send via Resend.
//
// All send paths are wrapped in try/catch by the caller so an email
// failure NEVER blocks the main business flow (account creation,
// withdrawal approval, etc.). Email outages must not break the broker.

import { Resend } from 'resend'
import { prisma } from '../prisma.js'
import { renderTemplate } from './templates.js'

const RESEND_KEY   = process.env.RESEND_API_KEY ?? ''
const FROM_EMAIL   = process.env.EMAIL_FROM      ?? 'noreply@vx-global.com'
const FROM_NAME    = process.env.EMAIL_FROM_NAME ?? 'Vx Global'
const FRONTEND_URL = process.env.FRONTEND_URL    ?? 'https://vx-global.com'
// Self-hosted by default — apps/web ships vx-logo.png in /public so the
// file is served at `${FRONTEND_URL}/vx-logo.png` with no extra setup.
// Override with EMAIL_LOGO_URL only if you need a CDN-hosted variant.
const LOGO_URL     = process.env.EMAIL_LOGO_URL  ?? `${FRONTEND_URL}/vx-logo.png`

// Brand variables injected into every template render — keeps the logo
// URL and CTA targets in one place and lets us swap them via env without
// touching the email rows in the DB.
export const BRAND_VARS = {
  logo_url:   LOGO_URL,
  app_url:    FRONTEND_URL,
  brand_name: FROM_NAME,
}

// Lazy-initialised so the API can boot without the key set (the email
// module is optional in dev). Throws on first use if still missing,
// caught by the wrapping try/catch at the call sites.
let _resend: Resend | null = null
function client(): Resend {
  if (_resend) return _resend
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not configured')
  _resend = new Resend(RESEND_KEY)
  return _resend
}

export interface SendEmailOptions {
  /** Template key in the email_templates table (e.g. 'WELCOME'). */
  templateKey: string
  /** Recipient address. */
  to:          string
  /** Variables substituted into subject + htmlBody — {{name}} → vars.name */
  vars:        Record<string, string | number>
  /** Optional override of the From address (useful for replies to tickets). */
  fromOverride?: string
}

export interface SendEmailResult {
  sent:      boolean
  reason?:   'TEMPLATE_NOT_FOUND' | 'TEMPLATE_INACTIVE' | 'SEND_FAILED'
  messageId?: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const tpl = await prisma.emailTemplate.findUnique({ where: { key: opts.templateKey } })
  if (!tpl) {
    console.warn(`[email] template not found: ${opts.templateKey}`)
    return { sent: false, reason: 'TEMPLATE_NOT_FOUND' }
  }
  if (!tpl.active) {
    return { sent: false, reason: 'TEMPLATE_INACTIVE' }
  }

  // Caller-provided vars win over BRAND_VARS so a template can override
  // (e.g. a custom logo per campaign) without changing the renderer.
  const mergedVars = { ...BRAND_VARS, ...opts.vars }
  const subject  = renderTemplate(tpl.subject,  mergedVars)
  const htmlBody = renderTemplate(tpl.htmlBody, mergedVars)

  try {
    const { data, error } = await client().emails.send({
      from:    opts.fromOverride ?? `${FROM_NAME} <${FROM_EMAIL}>`,
      to:      opts.to,
      subject,
      html:    htmlBody,
    })
    if (error) {
      console.error(`[email] resend rejected (${opts.templateKey} → ${opts.to})`, error)
      return { sent: false, reason: 'SEND_FAILED' }
    }
    return { sent: true, messageId: data?.id }
  } catch (err) {
    console.error(`[email] send threw (${opts.templateKey} → ${opts.to})`, err)
    return { sent: false, reason: 'SEND_FAILED' }
  }
}

/**
 * Fire-and-forget wrapper for trigger sites that shouldn't await or care
 * about the result. Logs errors but never throws — safe to call from any
 * business flow.
 */
export function sendEmailAsync(opts: SendEmailOptions): void {
  void sendEmail(opts).catch((err) => {
    console.error('[email] sendEmailAsync rejection', err)
  })
}
