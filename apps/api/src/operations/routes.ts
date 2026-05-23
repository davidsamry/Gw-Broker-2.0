import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createOperationSchema } from './schema.js'
import { createOperation, getOperation, listOperations } from './service.js'

const listQuerySchema = z.object({
  accountId: z.string().cuid().optional(),
})

export async function operationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate)

  app.post('/', async (req, reply) => {
    const parsed = createOperationSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const userId = ((req as any).user.sub) as string
    try {
      const operation = await createOperation(userId, parsed.data)
      return reply.status(201).send({ operation })
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      }
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({ error: 'INSUFFICIENT_BALANCE' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const userId = ((req as any).user.sub) as string
    try {
      const operations = await listOperations(userId, parsed.data.accountId)
      return reply.send({ operations })
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({ error: 'ACCOUNT_NOT_FOUND' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  app.get('/:id', async (req, reply) => {
    const userId = ((req as any).user.sub) as string
    const { id } = req.params as { id: string }
    try {
      const operation = await getOperation(userId, id)
      return reply.send({ operation })
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') {
        return reply.status(404).send({ error: 'NOT_FOUND' })
      }
      req.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })
}
