import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { otcBus, type OtcTickEvent } from './events.js'

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

// Optional comma-separated allowlist of asset ids — pass ?assets=eur-chf-otc,btc-otc
// to limit the stream to a subset. Empty/missing means "all OTC ticks".
const streamQuery = z.object({
  assets: z.string().trim().min(1).optional(),
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

  // ── Live tick stream (Server-Sent Events) ────────────────────────────────
  // Subscribes to the in-process OTC bus and forwards every tick to the
  // client as `event: tick / data: {assetId,price,time}`. Optional
  // ?assets=a,b,c restricts the stream to those ids.
  //
  // Why SSE not WebSocket: one-way (server→client), runs over plain HTTP/1.1,
  // crosses proxies cleanly, browser auto-reconnects via EventSource, no
  // extra deps. Trade-off is no client→server messaging — fine here since
  // chart only reads.
  //
  // Heartbeat: SSE comment line every 25s keeps the connection alive across
  // load balancers / corporate proxies that idle-kill at 60s.
  app.get('/stream', async (req, reply) => {
    const q = streamQuery.safeParse(req.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const allow = q.data.assets
      ? new Set(q.data.assets.split(',').map((s) => s.trim()).filter(Boolean))
      : null

    // Take over the raw response so Fastify doesn't try to serialize after.
    reply.raw.setHeader('Content-Type',  'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection',    'keep-alive')
    // Disable Nginx/proxy buffering — without this the first event can be
    // held for seconds while a buffer fills.
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders?.()

    // Initial comment so the browser commits to the response immediately
    // instead of waiting on the first event.
    reply.raw.write(': connected\n\n')

    const onTick = (e: OtcTickEvent) => {
      if (allow && !allow.has(e.assetId)) return
      // Don't block the worker if write fails (client gone). Best-effort.
      try {
        reply.raw.write(`event: tick\ndata: ${JSON.stringify(e)}\n\n`)
      } catch {
        cleanup()
      }
    }

    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n') } catch { cleanup() }
    }, 25_000)

    function cleanup() {
      clearInterval(heartbeat)
      otcBus.off('tick', onTick)
      try { reply.raw.end() } catch { /* already ended */ }
    }

    otcBus.on('tick', onTick)
    // Browser closed tab / network drop — release listener + heartbeat.
    req.raw.on('close', cleanup)
    req.raw.on('error', cleanup)
  })
}
