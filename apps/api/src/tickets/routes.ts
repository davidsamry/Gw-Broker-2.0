import type { FastifyInstance } from 'fastify'
import {
  createTicket,
  getUserTicketDetail,
  listUserTickets,
  replyAsUser,
} from './service.js'
import { TICKET_BODY_LIMIT, createTicketSchema, replyTicketSchema } from './schema.js'

export async function ticketRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate)

  // List the authed user's tickets.
  app.get('/', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    try {
      const tickets = await listUserTickets(userId)
      return reply.send({ tickets })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Detail (only if owner).
  app.get('/:id', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    const { id } = req.params as { id: string }
    try {
      const ticket = await getUserTicketDetail(userId, id)
      if (!ticket) return reply.status(404).send({ error: 'TICKET_NOT_FOUND' })
      return reply.send({ ticket })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Create — bodyLimit bumped to fit the optional base64 attachment.
  app.post('/', { bodyLimit: TICKET_BODY_LIMIT }, async (req, reply) => {
    const parsed = createTicketSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = ((req as any).user.sub) as string
    try {
      const ticket = await createTicket(userId, parsed.data)
      return reply.status(201).send({ ticket })
    } catch (err) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Reply (text + optional image; at least one required by the schema).
  app.post('/:id/messages', { bodyLimit: TICKET_BODY_LIMIT }, async (req, reply) => {
    const parsed = replyTicketSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const userId = ((req as any).user.sub) as string
    const { id } = req.params as { id: string }
    try {
      const messageId = await replyAsUser(userId, id, parsed.data)
      return reply.send({ ok: true, messageId })
    } catch (err: any) {
      if (err.message === 'TICKET_NOT_FOUND') return reply.status(404).send({ error: 'TICKET_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
