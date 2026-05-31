// Leitura paginada do admin_audit_log pra exibicao no painel.
//
// Raw SQL pra evitar dependencia do client Prisma regenerado (mesma
// abordagem dos outros admin services). Joina com users pra trazer
// admin.email no resultado — facilita ler "quem fez" sem mais 1 round-trip.

import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'

export interface AuditLogRow {
  id:           string         // BigInt serializado como string (JSON-safe)
  createdAt:    Date
  resourceType: string
  resourceId:   string | null
  action:       string
  adminId:      string
  adminEmail:   string | null
  adminName:    string | null
  ip:           string | null
  userAgent:    string | null
  before:       unknown
  after:        unknown
}

export interface ListAuditLogParams {
  page?:         number
  pageSize?:     number
  resourceType?: string
  resourceId?:   string
  adminId?:      string
  action?:       string
  /** YYYY-MM-DD ou ISO datetime — startOfDay aplicado se so' date */
  dateFrom?:     string
  /** YYYY-MM-DD ou ISO datetime — endOfDay aplicado se so' date */
  dateTo?:       string
}

export interface ListAuditLogResponse {
  entries:  AuditLogRow[]
  total:    number
  page:     number
  pageSize: number
}

export async function listAuditLogs(params: ListAuditLogParams): Promise<ListAuditLogResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(10, params.pageSize ?? 50))
  const offset   = (page - 1) * pageSize

  const where: Prisma.Sql[] = []
  if (params.resourceType) where.push(Prisma.sql`l."resourceType" = ${params.resourceType}`)
  if (params.resourceId)   where.push(Prisma.sql`l."resourceId"   = ${params.resourceId}`)
  if (params.adminId)      where.push(Prisma.sql`l."adminId"      = ${params.adminId}`)
  if (params.action)       where.push(Prisma.sql`l.action         = ${params.action}`)
  if (params.dateFrom) {
    // se vier so date (YYYY-MM-DD), Postgres interpreta como 00:00:00 — OK
    where.push(Prisma.sql`l."createdAt" >= ${new Date(params.dateFrom)}`)
  }
  if (params.dateTo) {
    // se vier so date, queremos INCLUIR o dia inteiro — somar 1d e usar <
    const to = new Date(params.dateTo)
    if (params.dateTo.length === 10) to.setUTCDate(to.getUTCDate() + 1)
    where.push(Prisma.sql`l."createdAt" < ${to}`)
  }
  const whereSql = where.length
    ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`
    : Prisma.empty

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: bigint; createdAt: Date;
      resourceType: string; resourceId: string | null; action: string;
      adminId: string; adminEmail: string | null; adminName: string | null;
      ip: string | null; userAgent: string | null;
      before: unknown; after: unknown;
    }>>`
      SELECT
        l.id, l."createdAt",
        l."resourceType", l."resourceId", l.action,
        l."adminId",
        u.email AS "adminEmail",
        u.name  AS "adminName",
        l.ip, l."userAgent",
        l."before", l."after"
      FROM admin_audit_log l
      LEFT JOIN users u ON u.id = l."adminId"
      ${whereSql}
      ORDER BY l."createdAt" DESC, l.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM admin_audit_log l ${whereSql}
    `,
  ])

  return {
    entries: rows.map(r => ({
      ...r,
      id: r.id.toString(),   // BigInt → string pra JSON
    })),
    total:    Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  }
}
