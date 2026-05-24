import { randomUUID } from 'node:crypto'
import { prisma } from '../prisma.js'
import type { CreateTicketInput, ReplyTicketInput } from './schema.js'

// User-side tickets module. Owner-scoped: every read/write checks userId.
// Admin-side is in apps/api/src/admin/tickets/ — kept separate so we don't
// risk leaking other users' tickets through the same query path.

export type TicketStatus   = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export interface UserTicketRow {
  id:             string
  subject:        string
  status:         TicketStatus
  priority:       TicketPriority
  createdAt:      Date
  lastActivityAt: Date
  messageCount:   number
  lastBody:       string | null    // preview of the most recent message
  lastIsAdmin:    boolean | null   // shows admin badge in list
}

export interface UserTicketMessage {
  id:            string
  ticketId:      string
  authorId:      string
  authorName:    string
  isAdmin:       boolean
  body:          string
  attachmentUrl: string | null
  createdAt:     Date
}

export interface UserTicketDetail extends UserTicketRow {
  messages: UserTicketMessage[]
}

// Atomic CTE: insert Ticket + first TicketMessage in one round-trip.
// lastActivityAt mirrors createdAt for new tickets.
export async function createTicket(userId: string, input: CreateTicketInput): Promise<UserTicketRow> {
  const ticketId  = randomUUID()
  const messageId = randomUUID()

  const rows = await prisma.$queryRaw<Array<UserTicketRow>>`
    WITH
      ins_t AS (
        INSERT INTO tickets (id, "userId", subject, status, priority, "createdAt", "updatedAt", "lastActivityAt")
        VALUES (${ticketId}, ${userId}, ${input.subject},
                'OPEN'::"TicketStatus", 'MEDIUM'::"TicketPriority",
                NOW(), NOW(), NOW())
        RETURNING id, subject, status::text AS status, priority::text AS priority,
                  "createdAt", "lastActivityAt"
      ),
      ins_m AS (
        INSERT INTO ticket_messages (id, "ticketId", "authorId", "isAdmin", body, "attachmentUrl", "createdAt")
        VALUES (${messageId}, ${ticketId}, ${userId}, FALSE,
                ${input.body}, ${input.attachmentUrl ?? null}, NOW())
        RETURNING id
      )
    SELECT t.id, t.subject, t.status, t.priority, t."createdAt", t."lastActivityAt",
           1::int AS "messageCount",
           ${input.body}::text AS "lastBody",
           FALSE AS "lastIsAdmin"
    FROM ins_t t
  `
  return rows[0]
}

export async function listUserTickets(userId: string): Promise<UserTicketRow[]> {
  return prisma.$queryRaw<UserTicketRow[]>`
    SELECT
      t.id,
      t.subject,
      t.status::text   AS status,
      t.priority::text AS priority,
      t."createdAt",
      t."lastActivityAt",
      (SELECT COUNT(*)::int FROM ticket_messages m WHERE m."ticketId" = t.id) AS "messageCount",
      (SELECT m.body    FROM ticket_messages m WHERE m."ticketId" = t.id ORDER BY m."createdAt" DESC LIMIT 1) AS "lastBody",
      (SELECT m."isAdmin" FROM ticket_messages m WHERE m."ticketId" = t.id ORDER BY m."createdAt" DESC LIMIT 1) AS "lastIsAdmin"
    FROM tickets t
    WHERE t."userId" = ${userId}
    ORDER BY t."lastActivityAt" DESC
    LIMIT 100
  `
}

export async function getUserTicketDetail(userId: string, ticketId: string): Promise<UserTicketDetail | null> {
  const head = await prisma.$queryRaw<UserTicketRow[]>`
    SELECT
      t.id, t.subject,
      t.status::text   AS status,
      t.priority::text AS priority,
      t."createdAt", t."lastActivityAt",
      (SELECT COUNT(*)::int FROM ticket_messages m WHERE m."ticketId" = t.id) AS "messageCount",
      NULL::text  AS "lastBody",
      NULL::bool  AS "lastIsAdmin"
    FROM tickets t
    WHERE t.id = ${ticketId} AND t."userId" = ${userId}
    LIMIT 1
  `
  if (head.length === 0) return null

  const messages = await prisma.$queryRaw<UserTicketMessage[]>`
    SELECT
      m.id, m."ticketId", m."authorId",
      a.name AS "authorName",
      m."isAdmin", m.body, m."attachmentUrl", m."createdAt"
    FROM ticket_messages m
    INNER JOIN users a ON a.id = m."authorId"
    WHERE m."ticketId" = ${ticketId}
    ORDER BY m."createdAt" ASC
  `

  return { ...head[0], messages }
}

// User reply. Requires ownership. Bumps lastActivityAt. If the ticket was
// RESOLVED / CLOSED and the user replies, reopen it to IN_PROGRESS so the
// admin sees it again. Atomic CTE.
export async function replyAsUser(userId: string, ticketId: string, input: ReplyTicketInput): Promise<string> {
  const messageId = randomUUID()
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH
      target AS (
        SELECT id FROM tickets WHERE id = ${ticketId} AND "userId" = ${userId}
      ),
      ins_m AS (
        INSERT INTO ticket_messages (id, "ticketId", "authorId", "isAdmin", body, "attachmentUrl", "createdAt")
        SELECT ${messageId}, ${ticketId}, ${userId}, FALSE,
               ${input.body ?? ''}, ${input.attachmentUrl ?? null}, NOW()
        WHERE EXISTS (SELECT 1 FROM target)
        RETURNING id
      ),
      upd_t AS (
        UPDATE tickets
        SET "lastActivityAt" = NOW(),
            "updatedAt"      = NOW(),
            status = CASE
              WHEN status IN ('RESOLVED'::"TicketStatus", 'CLOSED'::"TicketStatus")
                THEN 'IN_PROGRESS'::"TicketStatus"
              ELSE status
            END
        WHERE id IN (SELECT id FROM target)
        RETURNING id
      )
    SELECT id FROM ins_m
  `
  if (rows.length === 0) throw new Error('TICKET_NOT_FOUND')
  return rows[0].id
}
