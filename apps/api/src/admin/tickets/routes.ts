import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  deleteAdminMessage,
  getAdminTicketDetail,
  listAdminTickets,
  replyAsAdmin,
  updateTicketPriority,
  updateTicketStatus,
} from './service.js'
import { ticketAttachmentSchema, TICKET_BODY_LIMIT } from '../../tickets/schema.js'

const listQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
  search:   z.string().trim().min(1).optional(),
  status:   z.enum(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['ALL', 'LOW', 'MEDIUM', 'HIGH']).optional(),
})

const replySchema = z.object({
  body:          z.string().trim().max(5000).optional(),
  attachmentUrl: ticketAttachmentSchema.optional(),
}).refine(
  (v) => (v.body && v.body.length > 0) || (v.attachmentUrl && v.attachmentUrl.length > 0),
  { message: 'Envie um texto ou uma imagem.' },
)

const statusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
})

const prioritySchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
})

export async function ticketsAdminRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    try {
      const data = await listAdminTickets(parsed.data)
      return reply.send(data)
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      const data = await getAdminTicketDetail(id)
      if (!data) return reply.status(404).send({ error: 'TICKET_NOT_FOUND' })
      return reply.send({ ticket: data })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.post('/:id/reply', { bodyLimit: TICKET_BODY_LIMIT }, async (req, reply) => {
    const parsed = replySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id }  = req.params as { id: string }
    const adminId = ((req as any).user.sub) as string
    try {
      const messageId = await replyAsAdmin(adminId, id, parsed.data.body ?? '', parsed.data.attachmentUrl)
      return reply.send({ ok: true, messageId })
    } catch (err: any) {
      if (err.message === 'TICKET_NOT_FOUND') return reply.status(404).send({ error: 'TICKET_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Excluir uma mensagem (só do admin) do ticket.
  app.delete('/:id/messages/:messageId', async (req, reply) => {
    const { id, messageId } = req.params as { id: string; messageId: string }
    try {
      await deleteAdminMessage(id, messageId)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err.message === 'MESSAGE_NOT_FOUND') return reply.status(404).send({ error: 'MESSAGE_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.patch('/:id/status', async (req, reply) => {
    const parsed = statusSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id } = req.params as { id: string }
    try {
      await updateTicketStatus(id, parsed.data.status)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err.message === 'TICKET_NOT_FOUND') return reply.status(404).send({ error: 'TICKET_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.patch('/:id/priority', async (req, reply) => {
    const parsed = prioritySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { id } = req.params as { id: string }
    try {
      await updateTicketPriority(id, parsed.data.priority)
      return reply.send({ ok: true })
    } catch (err: any) {
      if (err.message === 'TICKET_NOT_FOUND') return reply.status(404).send({ error: 'TICKET_NOT_FOUND' })
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
