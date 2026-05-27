// Forex public REST endpoints.
//   /symbols  — F1: catalogue of enabled pairs
//   /status   — F1: runtime + provider state
//   /stream   — F4: SSE feed of live ticks + in-progress candles
//   /candles  — F5 (todo): REST query of historical bars
//   /ticker   — F5 (todo): latest snapshot per asset

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { getForexRuntimeState } from './runtime/boot.js'
import {
  forexBus,
  type ForexTickEvent,
  type ForexCandleEvent,
} from './stream/bus.js'

export async function forexRoutes(app: FastifyInstance) {
  // Public catalog — used by the frontend to show forex assets in the
  // asset selector. Read-only; no auth required (matches /market/assets).
  app.get('/symbols', async (_req, reply) => {
    try {
      const rows = await prisma.$queryRaw<Array<{
        id: string; symbol: string; name: string;
        digits: number; pipSize: string;
        displayOrder: number;
      }>>`
        SELECT id, symbol, name, digits, "pipSize"::text AS "pipSize", "displayOrder"
        FROM forex_assets
        WHERE enabled = TRUE
        ORDER BY "displayOrder" ASC, symbol ASC
      `
      return reply.send({
        symbols: rows.map(r => ({
          id:           r.id,
          symbol:       r.symbol,
          name:         r.name,
          digits:       r.digits,
          pipSize:      Number(r.pipSize),
          displayOrder: r.displayOrder,
        })),
      })
    } catch (err) {
      app.log.error(err)
      return reply.status(500).send({ error: 'INTERNAL_ERROR' })
    }
  })

  // Runtime/provider status — surfaced to the admin panel in F7. Public
  // (no PII) so an operator can hit it directly during incident response.
  app.get('/status', async (_req, reply) => {
    const s = getForexRuntimeState()
    return reply.send({
      bootedAt:      s.bootedAt,
      status:        s.status,
      providerAlive: s.provider !== null,
      providerName:  s.provider?.name ?? null,
      assets:        s.assets.length,
      debugInfo:     s.provider?.getDebugInfo() ?? null,
    })
  })

  // ── SSE stream ────────────────────────────────────────────────────────
  // Live tick + candle feed. Same shape as /otc/v2/stream so the
  // frontend chart can reuse its consumer with only the URL changing.
  //
  // Query params:
  //   assets  — comma-separated assetId filter. Omit for "all enabled".
  //   tf      — timeframe filter (60/300/900/3600). Omit for "all".
  //
  // Events emitted:
  //   tick    — { assetId, price, time }            (~1 per pair per 1.5s)
  //   candle  — full ForexCandleEvent shape         (interim + closed)
  //
  // Throttling: ticks 50ms (~20Hz cap), candles 250ms. Final-closed
  // candles bypass throttle so the chart never misses a rollover.
  app.get('/stream', async (req, reply) => {
    const q = streamQuery.safeParse(req.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const allowAssets = q.data.assets
      ? q.data.assets.split(',').map((s) => s.trim()).filter(Boolean)
      : null
    const onlyTf = q.data.tf ?? null

    // CORS — SSE writes direct to reply.raw, bypassing the cors plugin's
    // onSend hook. Mirror the headers manually (same pattern as /otc/v2/
    // stream and /operations/stream).
    const origin = (req.headers.origin as string | undefined) ?? ''
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
      reply.raw.setHeader('Vary', 'Origin')
    }
    reply.raw.setHeader('Content-Type',      'text/event-stream')
    reply.raw.setHeader('Cache-Control',     'no-cache, no-transform')
    reply.raw.setHeader('Connection',        'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders?.()
    reply.raw.write(': connected\n\n')

    const TICK_THROTTLE_MS   = 50    // ~20Hz tick cap
    const CANDLE_THROTTLE_MS = 250   // ~4Hz interim candle cap
    const lastTickEmitMs:   Map<string, number> = new Map()
    const lastCandleEmitMs: Map<string, number> = new Map()
    let closed = false

    const onTick = (e: ForexTickEvent) => {
      if (closed) return
      if (allowAssets && !allowAssets.includes(e.assetId)) return
      const last = lastTickEmitMs.get(e.assetId) ?? 0
      if (e.time - last < TICK_THROTTLE_MS) return
      lastTickEmitMs.set(e.assetId, e.time)
      try { reply.raw.write(`event: tick\ndata: ${JSON.stringify(e)}\n\n`) }
      catch { /* client gone — disconnect handler cleans up */ }
    }

    const onCandle = (e: ForexCandleEvent) => {
      if (closed) return
      if (allowAssets && !allowAssets.includes(e.assetId)) return
      if (onlyTf != null && e.timeframe !== onlyTf) return
      // Final-closed candles bypass throttle — losing a rollover would
      // create a visible gap on the chart.
      if (!e.isClosed) {
        const key  = `${e.assetId}:${e.timeframe}`
        const last = lastCandleEmitMs.get(key) ?? 0
        const now  = Date.now()
        if (now - last < CANDLE_THROTTLE_MS) return
        lastCandleEmitMs.set(key, now)
      }
      try { reply.raw.write(`event: candle\ndata: ${JSON.stringify(e)}\n\n`) }
      catch { /* client gone */ }
    }

    forexBus.on('tick',   onTick)
    forexBus.on('candle', onCandle)

    // Heartbeat every 25s — keeps the connection alive through proxy
    // idle timeouts (Cloudflare 100s, Traefik 60s default).
    const heartbeat = setInterval(() => {
      try { reply.raw.write(`: hb ${Date.now()}\n\n`) } catch { /* gone */ }
    }, 25_000)

    // Cleanup on client disconnect — covers both clean close + network
    // drop (Node fires 'close' for both).
    req.raw.on('close', () => {
      closed = true
      clearInterval(heartbeat)
      forexBus.off('tick',   onTick)
      forexBus.off('candle', onCandle)
    })
  })
}

const streamQuery = z.object({
  assets: z.string().optional(),
  tf:     z.coerce.number().int().optional(),
})
