// Admin service for email templates — list/get/update/test.
//
// Templates are seeded by the migration and edited live by admins via
// the panel. Updates write to email_templates + an entry in
// otc_admin_logs so we have an audit trail of who changed what.

import { prisma } from '../../prisma.js'
import { sendEmail, BRAND_VARS } from '../../email/service.js'
import { extractTemplateVariables, renderTemplate } from '../../email/templates.js'

export interface AdminEmailTemplate {
  key:         string
  name:        string
  description: string
  subject:     string
  htmlBody:    string
  variables:   string[]
  active:      boolean
  updatedAt:   string
}

function toRow(t: {
  key: string; name: string; description: string;
  subject: string; htmlBody: string; variables: string[];
  active: boolean; updatedAt: Date;
}): AdminEmailTemplate {
  return {
    key: t.key, name: t.name, description: t.description,
    subject: t.subject, htmlBody: t.htmlBody,
    variables: t.variables, active: t.active,
    updatedAt: t.updatedAt.toISOString(),
  }
}

export async function listAdminEmailTemplates(): Promise<AdminEmailTemplate[]> {
  const rows = await prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } })
  return rows.map(toRow)
}

export async function getAdminEmailTemplate(key: string): Promise<AdminEmailTemplate | null> {
  const t = await prisma.emailTemplate.findUnique({ where: { key } })
  return t ? toRow(t) : null
}

export interface UpdateEmailTemplateInput {
  subject?:  string
  htmlBody?: string
  active?:   boolean
}

export async function updateAdminEmailTemplate(
  adminId: string,
  key:     string,
  input:   UpdateEmailTemplateInput,
): Promise<AdminEmailTemplate | null> {
  const before = await prisma.emailTemplate.findUnique({ where: { key } })
  if (!before) return null

  // When the body changes, re-extract the variables list so the admin UI's
  // "available vars" chips stay accurate.
  const nextBody = input.htmlBody ?? before.htmlBody
  const nextSubject = input.subject ?? before.subject
  const allVarsSource = `${nextSubject}\n${nextBody}`
  const variables = extractTemplateVariables(allVarsSource)

  const updated = await prisma.emailTemplate.update({
    where: { key },
    data: {
      subject:  nextSubject,
      htmlBody: nextBody,
      active:   input.active ?? before.active,
      variables,
    },
  })

  // Audit log — reuse the existing otc_admin_logs table since it's the
  // only admin audit sink we have today.
  try {
    await prisma.$executeRaw`
      INSERT INTO otc_admin_logs ("adminId", action, "assetId", "beforeState", "afterState", "createdAt")
      VALUES (
        ${adminId},
        ${'UPDATE_EMAIL_TEMPLATE'},
        ${null},
        ${JSON.stringify({ key, subject: before.subject, active: before.active })}::jsonb,
        ${JSON.stringify({ key, subject: updated.subject, active: updated.active })}::jsonb,
        NOW()
      )
    `
  } catch (err) {
    console.error('[admin/emails] audit log failed', err)
  }

  return toRow(updated)
}

/**
 * Sends the configured template to the admin's own email address with
 * placeholder vars filled in. Used by the panel's "Testar" button — lets
 * the admin preview rendering + verify SMTP delivery without messaging
 * a real user.
 */
export async function sendTestEmail(
  key:      string,
  adminEmail: string,
): Promise<{ ok: boolean; reason?: string; messageId?: string }> {
  const tpl = await prisma.emailTemplate.findUnique({ where: { key } })
  if (!tpl) return { ok: false, reason: 'TEMPLATE_NOT_FOUND' }

  // Fill every declared variable with a clearly-fake value — but SKIP
  // keys that BRAND_VARS already provides (logo_url, brand_name, app_url).
  // Otherwise the sampleValueFor fallback returns `[logo_url]` etc. which
  // overrides the real values in sendEmail's `{ ...BRAND_VARS, ...vars }`
  // merge → broken <img src="[logo_url]"> + literal "[brand_name]" text.
  const sampleVars: Record<string, string> = {}
  for (const v of tpl.variables) {
    if (v in BRAND_VARS) continue
    sampleVars[v] = sampleValueFor(v)
  }

  const result = await sendEmail({
    templateKey: key,
    to:          adminEmail,
    vars:        sampleVars,
  })
  return {
    ok:        result.sent,
    reason:    result.reason,
    messageId: result.messageId,
  }
}

/**
 * Renders a template with sample variables for the "Visualizar" modal.
 * No actual send — just returns the rendered HTML + subject for an
 * inline preview pane.
 */
export async function previewEmailTemplate(key: string): Promise<{
  subject: string; html: string
} | null> {
  const tpl = await prisma.emailTemplate.findUnique({ where: { key } })
  if (!tpl) return null
  // Same skip-BRAND_VARS-keys logic as sendTestEmail — see comment there.
  const sampleVars: Record<string, string> = {}
  for (const v of tpl.variables) {
    if (v in BRAND_VARS) continue
    sampleVars[v] = sampleValueFor(v)
  }
  const mergedVars = { ...BRAND_VARS, ...sampleVars }
  return {
    subject: renderTemplate(tpl.subject, mergedVars),
    html:    renderTemplate(tpl.htmlBody, mergedVars),
  }
}

// Sensible defaults per common variable name. Falls back to a labelled
// placeholder so the admin can spot any unrecognised var.
function sampleValueFor(varName: string): string {
  const lower = varName.toLowerCase()
  if (lower === 'name' || lower === 'first_name') return 'João Silva'
  if (lower === 'email')          return 'joao.silva@example.com'
  if (lower === 'amount')         return '500,00'
  if (lower === 'cpf')            return '123.456.789-00'
  if (lower === 'reset_link')     return 'https://vx-global.com/reset-password?token=demo'
  if (lower === 'verification_link') return 'https://vx-global.com/verify?token=demo'
  if (lower === 'ticket_subject') return 'Dúvida sobre depósito PIX'
  if (lower === 'message')        return 'Olá! Recebemos sua solicitação e estamos analisando. Em breve retornaremos com a resposta.'
  if (lower === 'reason')         return 'Documento ilegível — reenvie uma foto mais nítida.'
  if (lower === 'platform_name')  return 'Vx Global'
  if (lower === 'timestamp')      return new Date().toLocaleString('pt-BR')
  return `[${varName}]`
}
