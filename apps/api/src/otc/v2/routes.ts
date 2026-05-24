import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getCachedCandles, getCurrentPrice } from './worker.js'
import { otcV2Bus, type OtcV2CandleEvent, type OtcV2TickEvent } from './events.js'
import { CANDLES_PER_TF, OTC_TIMEFRAMES, type OtcTimeframe } from './types.js'

// Public OTC v2 endpoints. Auth is intentionally absent — pricing is
// the same for everyone, mirrors how /market/assets and /otc/* (v1)
// work. The legacy /otc/* routes still respond (Etapa 8 cleans them).

const ALLOWED_TFS = new Set<number>(OTC_TIMEFRAMES)

const candlesParams = z.object({ assetId: z.string().min(1) })
const candlesQuery  = z.object({
  tf:    z.coerce.number().int().refine((v): v is OtcTimeframe => ALLOWED_TFS.has(v), 'Timeframe inválido.').default(60),
  limit: z.coerce.number().int().min(1).max(CANDLES_PER_TF).default(CANDLES_PER_TF),
})

const tickerParams = z.object({ assetId: z.string().min(1) })

// Optional filters for the SSE stream. assets = comma-separated ids;
// tf = restricts candle events to this timeframe (tick events are not
// timeframe-bound). Leave both empty to receive everything.
const streamQuery = z.object({
  assets: z.string().trim().min(1).optional(),
  tf:     z.coerce.number().int().refine((v): v is OtcTimeframe => ALLOWED_TFS.has(v), 'Timeframe inválido.').optional(),
})

export async function otcV2Routes(app: FastifyInstance) {
  // ── Historical candles ────────────────────────────────────────────────
  // Served from the in-memory ring buffer the worker maintains. No DB
  // hit on the read path → ~0ms response. Up to CANDLES_PER_TF (3000)
  // most recent bars per (asset, tf).
  app.get('/candles/:assetId', async (req, reply) => {
    const p = candlesParams.safeParse(req.params)
    if (!p.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    const q = candlesQuery.safeParse(req.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', details: q.error.flatten() })

    const cached = getCachedCandles(p.data.assetId, q.data.tf, q.data.limit)
    // Map to a compact wire format (epoch seconds for the chart axis).
    return reply.send({
      assetId:  p.data.assetId,
      tf:       q.data.tf,
      candles:  cached.map(c => ({
        time:  Math.floor(c.openTime.getTime() / 1000),
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      })),
    })
  })

  // ── Current price (latest tick) ──────────────────────────────────────
  app.get('/ticker/:assetId', async (req, reply) => {
    const p = tickerParams.safeParse(req.params)
    if (!p.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })
    const price = getCurrentPrice(p.data.assetId)
    if (price == null) return reply.status(404).send({ error: 'ASSET_NOT_FOUND' })
    return reply.send({ assetId: p.data.assetId, price, time: Date.now() })
  })

  // ── Live SSE stream ──────────────────────────────────────────────────
  // Three event types — chart subscribes once and dispatches:
  //   • tick         → small {assetId, price, time} — updates price label
  //                    THROTTLED to 5Hz per (assetId, client) so a busy
  //                    chart with multiple OTC tabs doesn't drown the
  //                    browser in JSON.parse.
  //   • candleUpdate → in-progress OHLC for the current bar; 1Hz per
  //                    (asset:tf, client) — enough for smooth body
  //                    growth without flooding.
  //   • candle       → finalized OHLC at rollover — NEVER throttled, the
  //                    chart needs every rollover to start a new bar.
  app.get('/stream', async (req, reply) => {
    const q = streamQuery.safeParse(req.query)
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR' })

    const allowAssets = q.data.assets
      ? new Set(q.data.assets.split(',').map(s => s.trim()).filter(Boolean))
      : null
    const onlyTf = q.data.tf ?? null

    reply.raw.setHeader('Content-Type',     'text/event-stream')
    reply.raw.setHeader('Cache-Control',    'no-cache, no-transform')
    reply.raw.setHeader('Connection',       'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')   // disable Nginx buffering
    reply.raw.flushHeaders?.()
    reply.raw.write(': connected\n\n')

    // ── Per-client throttle state ──────────────────────────────────────
    // tick: last-emit time per assetId
    const lastTickEmitMs   = new Map<string, number>()
    // candleUpdate: last-emit time per `${assetId}:${tf}`
    const lastCandleEmitMs = new Map<string, number>()
    const TICK_THROTTLE_MS   = 200    // ≈ 5Hz
    const CANDLE_THROTTLE_MS = 1000   // 1Hz

    const onTick = (e: OtcV2TickEvent) => {
      if (allowAssets && !allowAssets.has(e.assetId)) return
      const last = lastTickEmitMs.get(e.assetId) ?? 0
      if (e.time - last < TICK_THROTTLE_MS) return
      lastTickEmitMs.set(e.assetId, e.time)
      try {
        reply.raw.write(`event: tick\ndata: ${JSON.stringify(e)}\n\n`)
      } catch { cleanup() }
    }

    const onCandle = (e: OtcV2CandleEvent) => {
      if (allowAssets && !allowAssets.has(e.assetId)) return
      if (onlyTf != null && e.timeframe !== onlyTf) return

      // Finalized candle — always pass through (it's the chart's
      // bar-rollover signal, missing one creates a gap).
      if (e.isClosed) {
        try {
          reply.raw.write(`event: candle\ndata: ${JSON.stringify(e)}\n\n`)
        } catch { cleanup() }
        // Reset the throttle counter for this asset:tf so the next
        // candleUpdate emits promptly instead of waiting up to 1s.
        lastCandleEmitMs.delete(`${e.assetId}:${e.timeframe}`)
        return
      }

      const key = `${e.assetId}:${e.timeframe}`
      const last = lastCandleEmitMs.get(key) ?? 0
      const now = Date.now()
      if (now - last < CANDLE_THROTTLE_MS) return
      lastCandleEmitMs.set(key, now)
      try {
        reply.raw.write(`event: candleUpdate\ndata: ${JSON.stringify(e)}\n\n`)
      } catch { cleanup() }
    }

    // Keep-alive comment every 25s — survives proxies / Cloudflare's 60s
    // idle kill without blowing through the actual data path.
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n') } catch { cleanup() }
    }, 25_000)

    function cleanup() {
      clearInterval(heartbeat)
      otcV2Bus.off('tick',   onTick)
      otcV2Bus.off('candle', onCandle)
      try { reply.raw.end() } catch { /* already ended */ }
    }

    otcV2Bus.on('tick',   onTick)
    otcV2Bus.on('candle', onCandle)
    req.raw.on('close', cleanup)
    req.raw.on('error', cleanup)
  })
}
