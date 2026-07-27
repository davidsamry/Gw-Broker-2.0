import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { sendEmailAsync } from '../../email/service.js'

// Admin tickets management — raw SQL throughout (consistent with the other
// admin services + tolerant of stale Prisma client during schema iterations).

export type TicketStatus   = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export interface TicketRow {
  id:             string
  userId:         string
  userName:       string
  userEmail:      string
  subject:        string
  status:         TicketStatus
  priority:       TicketPriority
  createdAt:      Date
  lastActivityAt: Date
  messageCount:   number
}

export interface TicketMessageRow {
  id:            string
  ticketId:      string
  authorId:      string
  authorName:    string
  isAdmin:       boolean
  body:          string
  attachmentUrl: string | null
  createdAt:     Date
}

export interface TicketDetailRow extends TicketRow {
  messages: TicketMessageRow[]
}

export interface ListTicketsParams {
  page?:     number
  pageSize?: number
  search?:   string
  status?:   'ALL' | TicketStatus
  priority?: 'ALL' | TicketPriority
}

export interface TicketCounts {
  total:      number
  open:       number  // OPEN
  inProgress: number  // IN_PROGRESS
  resolved:   number  // RESOLVED
  closed:     number  // CLOSED
}

export interface ListTicketsResponse {
  tickets:  TicketRow[]
  total:    number
  page:     number
  pageSize: number
  counts:   TicketCounts
}

export async function listAdminTickets(params: ListTicketsParams): Promise<ListTicketsResponse> {
  const page     = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 50))
  const offset   = (page - 1) * pageSize

  const where: Prisma.Sql[] = []
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push(Prisma.sql`(t.subject ILIKE ${q} OR u.email ILIKE ${q} OR u.name ILIKE ${q})`)
  }
  if (params.status && params.status !== 'ALL') {
    where.push(Prisma.sql`t.status = ${params.status}::"TicketStatus"`)
  }
  if (params.priority && params.priority !== 'ALL') {
    where.push(Prisma.sql`t.priority = ${params.priority}::"TicketPriority"`)
  }
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty

  const [rows, countRows, kpiRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT
        t.id,
        t."userId",
        u.name  AS "userName",
        u.email AS "userEmail",
        t.subject,
        t.status::text   AS status,
        t.priority::text AS priority,
        t."createdAt",
        t."lastActivityAt",
        (SELECT COUNT(*)::int FROM ticket_messages m WHERE m."ticketId" = t.id) AS "messageCount"
      FROM tickets t
      INNER JOIN users u ON u.id = t."userId"
      ${whereSql}
      ORDER BY
        CASE
          WHEN t.status = 'OPEN'::"TicketStatus"        THEN 0
          WHEN t.status = 'IN_PROGRESS'::"TicketStatus" THEN 1
          ELSE 2
        END,
        t."lastActivityAt" DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM tickets t
      INNER JOIN users u ON u.id = t."userId"
      ${whereSql}
    `,
    // Global counts — header chips ignore filters.
    prisma.$queryRaw<Array<{
      total: bigint; open: bigint; inProgress: bigint; resolved: bigint; closed: bigint
    }>>`
      SELECT
        COUNT(*)::bigint                                                              AS total,
        COUNT(*) FILTER (WHERE status = 'OPEN'::"TicketStatus")::bigint               AS open,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS'::"TicketStatus")::bigint        AS "inProgress",
        COUNT(*) FILTER (WHERE status = 'RESOLVED'::"TicketStatus")::bigint           AS resolved,
        COUNT(*) FILTER (WHERE status = 'CLOSED'::"TicketStatus")::bigint             AS closed
      FROM tickets
    `,
  ])

  const tickets: TicketRow[] = rows.map((r) => ({
    ...r,
    messageCount: Number(r.messageCount ?? 0),
  }))

  const kpi = kpiRows[0]
  return {
    tickets,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
    counts: {
      total:      Number(kpi?.total      ?? 0),
      open:       Number(kpi?.open       ?? 0),
      inProgress: Number(kpi?.inProgress ?? 0),
      resolved:   Number(kpi?.resolved   ?? 0),
      closed:     Number(kpi?.closed     ?? 0),
    },
  }
}

export async function getAdminTicketDetail(ticketId: string): Promise<TicketDetailRow | null> {
  const [head] = await prisma.$queryRaw<any[]>`
    SELECT
      t.id,
      t."userId",
      u.name  AS "userName",
      u.email AS "userEmail",
      t.subject,
      t.status::text   AS status,
      t.priority::text AS priority,
      t."createdAt",
      t."lastActivityAt",
      (SELECT COUNT(*)::int FROM ticket_messages m WHERE m."ticketId" = t.id) AS "messageCount"
    FROM tickets t
    INNER JOIN users u ON u.id = t."userId"
    WHERE t.id = ${ticketId}
    LIMIT 1
  `
  if (!head) return null

  const messages = await prisma.$queryRaw<TicketMessageRow[]>`
    SELECT
      m.id, m."ticketId", m."authorId",
      a.name AS "authorName",
      m."isAdmin", m.body, m."attachmentUrl", m."createdAt"
    FROM ticket_messages m
    INNER JOIN users a ON a.id = m."authorId"
    WHERE m."ticketId" = ${ticketId}
    ORDER BY m."createdAt" ASC
  `

  return { ...head, messageCount: Number(head.messageCount ?? 0), messages }
}

// Admin posts a reply. Bumps lastActivityAt and, if the ticket was still OPEN,
// moves it to IN_PROGRESS (admin took the first response). Atomic CTE.
export async function replyAsAdmin(adminId: string, ticketId: string, body: string, attachmentUrl?: string | null) {
  const messageId = randomUUID()
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      ins_msg AS (
        INSERT INTO ticket_messages (id, "ticketId", "authorId", "isAdmin", body, "attachmentUrl", "createdAt")
        SELECT ${messageId}, ${ticketId}, ${adminId}, TRUE, ${body}, ${attachmentUrl ?? null}, NOW()
        WHERE EXISTS (SELECT 1 FROM tickets WHERE id = ${ticketId})
        RETURNING id
      ),
      upd_ticket AS (
        UPDATE tickets
        SET "lastActivityAt" = NOW(),
            "updatedAt"      = NOW(),
            status = CASE
              WHEN status = 'OPEN'::"TicketStatus" THEN 'IN_PROGRESS'::"TicketStatus"
              ELSE status
            END
        WHERE id = ${ticketId}
        RETURNING id
      )
    SELECT id FROM ins_msg
  `
  if (rows.length === 0) throw new Error('TICKET_NOT_FOUND')

  // Email the user that there's a new reply waiting. Fire-and-forget —
  // ticket reply must succeed even if email is down.
  try {
    const info = await prisma.$queryRaw<Array<{
      email: string; name: string; subject: string
    }>>`
      SELECT u.email, u.name, t.subject
      FROM tickets t
      JOIN users   u ON u.id = t."userId"
      WHERE t.id = ${ticketId}
      LIMIT 1
    `
    const row = info[0]
    if (row) {
      sendEmailAsync({
        templateKey: 'TICKET_REPLIED',
        to:          row.email,
        vars:        { name: row.name, ticket_subject: row.subject, message: body },
      })
    }
  } catch (err) {
    console.error('[admin/tickets] reply notification lookup failed', err)
  }

  return rows[0].id
}

// Apaga uma mensagem do ADMIN do ticket. NÃO permite apagar mensagem do
// usuário (isAdmin=false) — só as respostas enviadas pela equipe.
export async function deleteAdminMessage(ticketId: string, messageId: string) {
  const result = await prisma.$executeRaw`
    DELETE FROM ticket_messages
    WHERE id = ${messageId} AND "ticketId" = ${ticketId} AND "isAdmin" = TRUE
  `
  if (result === 0) throw new Error('MESSAGE_NOT_FOUND')
}

// Exclui o ticket INTEIRO (todas as mensagens + o ticket). Hard delete —
// usado pelo admin pra limpar tickets resolvidos/spam. Apaga as mensagens
// primeiro (evita depender de ON DELETE CASCADE) e depois o ticket, tudo
// numa transação. Lança TICKET_NOT_FOUND se o ticket não existir.
export async function deleteTicket(ticketId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM ticket_messages WHERE "ticketId" = ${ticketId}`
    const result = await tx.$executeRaw`DELETE FROM tickets WHERE id = ${ticketId}`
    if (result === 0) throw new Error('TICKET_NOT_FOUND')
  })
}

export async function updateTicketStatus(ticketId: string, status: TicketStatus) {
  const result = await prisma.$executeRaw`
    UPDATE tickets
    SET status           = ${status}::"TicketStatus",
        "lastActivityAt" = NOW(),
        "updatedAt"      = NOW()
    WHERE id = ${ticketId}
  `
  if (result === 0) throw new Error('TICKET_NOT_FOUND')
}

export async function updateTicketPriority(ticketId: string, priority: TicketPriority) {
  const result = await prisma.$executeRaw`
    UPDATE tickets
    SET priority         = ${priority}::"TicketPriority",
        "lastActivityAt" = NOW(),
        "updatedAt"      = NOW()
    WHERE id = ${ticketId}
  `
  if (result === 0) throw new Error('TICKET_NOT_FOUND')
}
