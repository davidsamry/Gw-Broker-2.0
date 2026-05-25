import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getCachedCandles, getCurrentPrice } from './worker.js'
import { otcV2Bus, type OtcV2CandleEvent, type OtcV2TickEvent } from './events.js'
import { registerClient, unregisterClient } from './stream/registry.js'
import { CANDLES_PER_TF, OTC_TIMEFRAMES, type OtcTimeframe } from './types.js'
import {
  otcSseEventsEmittedTotal, otcSseEventsSkippedTotal,
} from '../../metrics/registry.js'

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
      ? q.data.assets.split(',').map(s => s.trim()).filter(Boolean)
      : null
    const onlyTf = q.data.tf ?? null

    // CORS — see Etapa 8 commit for full explanation. SSE writes
    // direct to reply.raw, bypassing @fastify/cors's onSend hook, so
    // we mirror the headers manually.
    const origin = (req.headers.origin as string | undefined) ?? ''
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
      reply.raw.setHeader('Vary', 'Origin')
    }
    reply.raw.setHeader('Content-Type',     'text/event-stream')
    reply.raw.setHeader('Cache-Control',    'no-cache, no-transform')
    reply.raw.setHeader('Connection',       'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')   // disable Nginx buffering
    reply.raw.flushHeaders?.()

    // Fase 6: register in the global SSE registry. Per-client throttle
    // state + stats live in the SseClient struct (was closure vars in
    // the old handler — registry version is admin-inspectable).
    const client = registerClient({ assets: allowAssets, timeframe: onlyTf })
    reply.raw.write(`: connected id=${client.id}\n\n`)

    const TICK_THROTTLE_MS   = 200    // ≈ 5Hz
    const CANDLE_THROTTLE_MS = 1000   // 1Hz

    // Fase 6 backpressure: when reply.raw.write returns false the
    // kernel's TCP send buffer is full. Subsequent writes get queued
    // in the Node stream's internal buffer (unbounded — memory leak
    // risk). We track 'drain' state and SKIP non-critical events
    // until the underlying socket asks for more.
    //
    // Finalized candles bypass this skip — losing one creates a
    // visible chart gap; better to queue them and trust 'drain' to
    // flush eventually.
    let drained = true
    reply.raw.on('drain', () => { drained = true })

    function tryWrite(payload: string): boolean {
      if (client.closed) return false
      const ok = reply.raw.write(payload)
      if (!ok) drained = false
      return true   // attempted; caller decides whether to count stats
    }

    const onTick = (e: OtcV2TickEvent) => {
      if (client.closed) return
      if (client.assets && !client.assets.includes(e.assetId)) return
      // Backpressure: skip ticks (cheap to drop, freshest tick always
      // arrives ~200ms later anyway).
      if (!drained) {
        client.candlesSkipped++
        otcSseEventsSkippedTotal.inc({ reason: 'backpressure' })
        return
      }
      const last = client.lastTickEmitMs.get(e.assetId) ?? 0
      if (e.time - last < TICK_THROTTLE_MS) {
        otcSseEventsSkippedTotal.inc({ reason: 'throttle' })
        return
      }
      client.lastTickEmitMs.set(e.assetId, e.time)
      if (tryWrite(`event: tick\ndata: ${JSON.stringify(e)}\n\n`)) {
        client.ticksReceived++
        otcSseEventsEmittedTotal.inc({ type: 'tick' })
      }
    }

    const onCandle = (e: OtcV2CandleEvent) => {
      if (client.closed) return
      if (client.assets && !client.assets.includes(e.assetId)) return
      if (client.timeframe != null && e.timeframe !== client.timeframe) return

      // Finalized — NEVER throttle, NEVER skip even under backpressure.
      // A missing rollover event creates a visible gap on the chart;
      // trust the stream's internal buffer + 'drain' to catch up.
      if (e.isClosed) {
        if (tryWrite(`event: candle\ndata: ${JSON.stringify(e)}\n\n`)) {
          client.candlesReceived++
          otcSseEventsEmittedTotal.inc({ type: 'candle' })
        }
        // Reset throttle so the next candleUpdate (new bar) emits
        // promptly instead of waiting up to 1s.
        client.lastCandleEmitMs.delete(`${e.assetId}:${e.timeframe}`)
        return
      }

      // In-progress candleUpdate — backpressure-skippable like ticks.
      if (!drained) {
        client.candlesSkipped++
        otcSseEventsSkippedTotal.inc({ reason: 'backpressure' })
        return
      }
      const key = `${e.assetId}:${e.timeframe}`
      const last = client.lastCandleEmitMs.get(key) ?? 0
      const now = Date.now()
      if (now - last < CANDLE_THROTTLE_MS) {
        otcSseEventsSkippedTotal.inc({ reason: 'throttle' })
        return
      }
      client.lastCandleEmitMs.set(key, now)
      if (tryWrite(`event: candleUpdate\ndata: ${JSON.stringify(e)}\n\n`)) {
        otcSseEventsEmittedTotal.inc({ type: 'candleUpdate' })
      }
    }

    // Keep-alive comment every 25s — survives proxies / Cloudflare's
    // 60s idle kill without blowing through the actual data path. If
    // the write fails, the connection's dead — clean up so we don't
    // leak the listener.
    const heartbeat = setInterval(() => {
      if (client.closed) return
      try {
        reply.raw.write(': ping\n\n')
      } catch {
        cleanup()
      }
    }, 25_000)

    // Idempotent cleanup. Fired by 'close', 'error', or write failure.
    // Guard flag prevents double-removal of bus listeners (which would
    // be harmless but noisy if it ever happened twice).
    let cleanedUp = false
    function cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      clearInterval(heartbeat)
      otcV2Bus.off('tick',   onTick)
      otcV2Bus.off('candle', onCandle)
      unregisterClient(client.id)
      try { reply.raw.end() } catch { /* already ended */ }
    }

    otcV2Bus.on('tick',   onTick)
    otcV2Bus.on('candle', onCandle)
    req.raw.on('close', cleanup)
    req.raw.on('error', cleanup)
  })
}
