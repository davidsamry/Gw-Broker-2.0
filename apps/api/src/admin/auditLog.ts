// Audit log generico — registra TODA admin action que muta estado.
//
// Uso:
//   import { recordAdminAction } from '../auditLog.js'
//
//   await recordAdminAction(req, {
//     resourceType: 'WITHDRAWAL',
//     resourceId:   withdrawalId,
//     action:       'APPROVE',
//     before:       { status: 'PENDING' },
//     after:        { status: 'APPROVED', approvedBy: adminId },
//   })
//
// Capturamos automaticamente do request:
//   - adminId        — de req.user.sub (set por requireAdmin)
//   - ip             — x-forwarded-for ou req.ip
//   - userAgent      — header User-Agent
//
// O try/catch envolve TUDO — se o INSERT do log falhar (banco fora,
// schema desincronizado, etc), a admin action NAO e' bloqueada. Log
// vai pra stderr pra debug. Filosofia: melhor admin action acontecer
// sem audit do que falhar por causa do audit.
//
// JSON.stringify usa bigintSafeReplacer (de admin/otc/service.ts) pra
// sobreviver a counts bigint que vem de Prisma raw queries.

import type { FastifyRequest } from 'fastify'
import { prisma } from '../prisma.js'
import { bigintSafeReplacer } from './otc/service.js'

/**
 * Categorias amplas de recurso. Tipo enumerado pra ferramentas de
 * busca conseguirem "todas as acoes em WITHDRAWAL" sem ambiguidade.
 * Manter em sync com o frontend (/admin/audit-log dropdown).
 */
export type AuditResourceType =
  | 'WITHDRAWAL'
  | 'USER'
  | 'DEPOSIT'
  | 'KYC'
  | 'OPERATION'
  | 'ASSET'
  | 'SETTINGS'
  | 'EMAIL_TEMPLATE'
  | 'BONUS_CODE'
  | 'RANKING_PRIZE'
  | 'TICKET'

export interface RecordAdminActionInput {
  resourceType: AuditResourceType
  /** null pra acoes globais (ex: UPDATE_SETTINGS) */
  resourceId:   string | null
  /** verbo: APPROVE, REJECT, BLOCK, UNBLOCK, UPDATE, DELETE, etc. */
  action:       string
  /** snapshot ANTES da mudanca. null se nao aplicavel (ex: CREATE). */
  before:       unknown
  /** snapshot DEPOIS da mudanca. null pra deletes hard. */
  after:        unknown
}

export async function recordAdminAction(
  req:   FastifyRequest,
  input: RecordAdminActionInput,
): Promise<void> {
  try {
    const adminId = (req.user as any)?.sub as string | undefined
    if (!adminId) {
      // requireAdmin garante isso, mas se chamado num route sem
      // preHandler errado, falhe silenciosamente em vez de explodir.
      console.warn('[audit] recordAdminAction sem adminId — chamada de rota nao-admin?')
      return
    }

    // IP: respeita x-forwarded-for do reverse proxy (EasyPanel sit atras
    // do Traefik). Pega so o primeiro IP da chain — os subsequentes sao
    // proxies intermediarios, nao o cliente real.
    const xfwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    const ip   = xfwd || req.ip || null
    const ua   = (req.headers['user-agent'] as string | undefined) ?? null

    const beforeJson = JSON.stringify(input.before ?? null, bigintSafeReplacer)
    const afterJson  = JSON.stringify(input.after  ?? null, bigintSafeReplacer)

    await prisma.$executeRaw`
      INSERT INTO admin_audit_log
        ("resourceType", "resourceId", action, "before", "after",
         "adminId", ip, "userAgent", "createdAt")
      VALUES
        (${input.resourceType}, ${input.resourceId}, ${input.action},
         ${beforeJson}::jsonb, ${afterJson}::jsonb,
         ${adminId}, ${ip}, ${ua}, NOW())
    `
  } catch (err) {
    // Falha de log NUNCA bloqueia a admin action. Surface to stderr pra
    // debug + Sentry futuramente.
    console.error('[audit] failed to record admin action', {
      resourceType: input.resourceType,
      resourceId:   input.resourceId,
      action:       input.action,
      err,
    })
  }
}
