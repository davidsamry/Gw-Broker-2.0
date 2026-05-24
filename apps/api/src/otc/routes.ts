import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'

// Public OTC pricing endpoints — chart bootstraps from /candles, then
// keeps fresh via /stream (Etapa 3). Auth is intentionally absent: pricing
// is the same for everyone and mirrors how /market/assets works.

const tickerParams  = z.object({ assetId: z.string().min(1) })

// Allowed candle timeframes — match the chart's selector.
const ALLOWED_TFS = [5, 15, 30, 60, 300, 900, 3600] as const
type AllowedTf = typeof ALLOWED_TFS[number]

const candlesQuery = z.object({
  tf:    z.coerce.number().int().refine((v): v is AllowedTf => ALLOWED_TFS.includes(v as AllowedTf), 'Timeframe inválido.').default(60),
  limit: z.coerce.number().int().min(1).max(500).default(150),
})

export async function otcRoutes(app: FastifyInstance) {
  // Last known price for an OTC asset. Returns 404 if the asset isn't OTC
  // (e.g. someone queries a Binance asset by mistake) or hasn't been
  // priced yet (worker never ticked it — likely seedPrice null).
  app.get('/ticker/:assetId', async (req, reply) => {
    const parsed = tickerParams.safeParse(req.params)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const rows = await prisma.$queryRaw<Array<{ price: any; recordedAt: Date }>>`
      SELECT t.price, t."recordedAt"
      FROM asset_price_ticks t
      WHERE t."assetId" = ${parsed.data.assetId}
      ORDER BY t."recordedAt" DESC
      LIMIT 1
    `
    if (rows.length === 0) {
      // Fall back to seedPrice if there's never been a tick yet — keeps
      // the chart from rendering blank on a fresh deploy.
      const seedRows = await prisma.$queryRaw<Array<{ seedPrice: any }>>`
        SELECT "seedPrice" FROM assets
        WHERE id = ${parsed.data.assetId}
          AND "marketSymbol" IS NULL
          AND "seedPrice" IS NOT NULL
        LIMIT 1
      `
      if (seedRows.length === 0) return reply.status(404).send({ error: 'NOT_OTC' })
      return reply.send({
        assetId:    parsed.data.assetId,
        price:      Number(seedRows[0].seedPrice),
        recordedAt: new Date().toISOString(),
      })
    }
    return reply.send({
      assetId:    parsed.data.assetId,
      price:      Number(rows[0].price),
      recordedAt: rows[0].recordedAt.toISOString(),
    })
  })

  // Historical OHLC candles derived from the tick stream. Buckets ticks
  // into `tf`-second windows using floor(epoch / tf) * tf.
  //
  // open/close use array_agg ordered by recordedAt — Postgres doesn't have
  // FIRST_VALUE without a window function, and aggregating once is cheaper
  // than two window passes over the same set.
  //
  // Heads-up: if `limit * tf` exceeds the retention window the query simply
  // returns fewer rows. Chart should handle a short series gracefully.
  app.get('/candles/:assetId', async (req, reply) => {
    const p = tickerParams.safeParse(req.params)
    if (!p.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    const q = candlesQuery.safeParse(req.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', details: q.error.flatten() })

    const { assetId } = p.data
    const { tf, limit } = q.data
    const windowSec = tf * limit

    const candles = await prisma.$queryRaw<Array<{
      bucket: Date; open: number; high: number; low: number; close: number
    }>>`
      SELECT
        to_timestamp(FLOOR(EXTRACT(EPOCH FROM "recordedAt") / ${tf}) * ${tf}) AS bucket,
        (array_agg(price ORDER BY "recordedAt" ASC))[1]::float8  AS open,
        MAX(price)::float8                                        AS high,
        MIN(price)::float8                                        AS low,
        (array_agg(price ORDER BY "recordedAt" DESC))[1]::float8 AS close
      FROM asset_price_ticks
      WHERE "assetId" = ${assetId}
        AND "recordedAt" > NOW() - (${windowSec} || ' seconds')::interval
      GROUP BY bucket
      ORDER BY bucket ASC
    `

    return reply.send({
      assetId,
      tf,
      candles: candles.map((c) => ({
        time:  Math.floor(c.bucket.getTime() / 1000),
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      })),
    })
  })
}
