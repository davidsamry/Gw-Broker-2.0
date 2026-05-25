// Fase M3 — Prometheus metrics registry.
//
// Single source of truth for every metric the API exports. Modules
// that emit metrics IMPORT from here rather than instantiating their
// own, so we never get duplicate registrations (which throws on prom-
// client) and so the /metrics route knows about every metric in one
// place.
//
// What's measured (focused on what we couldn't debug today without
// SSHing to read logs):
//
//   ENGINE
//     otc_ticks_emitted_total{assetId}            — counter
//     otc_candles_finalized_total{assetId, tf}    — counter
//     otc_regime_transitions_total{from, to}      — counter
//     otc_engine_assets_loaded                    — gauge
//     otc_engine_running                          — gauge (1|0)
//     otc_price_current{assetId}                  — gauge
//     otc_pending_ticks_size                      — gauge
//     otc_pending_candles_size                    — gauge
//
//   STORAGE
//     otc_db_query_duration_seconds{op}           — histogram
//     otc_db_query_errors_total{op}               — counter
//
//   STREAM
//     otc_sse_clients                             — gauge
//     otc_sse_events_emitted_total{type}          — counter
//     otc_sse_events_skipped_total{reason}        — counter
//
//   HTTP (instrumented by app.ts onResponse hook)
//     http_request_duration_seconds{method, route, status_code}
//
//   Plus standard Node.js process metrics (memory, GC, CPU) via
//   collectDefaultMetrics.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client'

// Dedicated registry — keeps our metrics scoped, no cross-pollution
// with anything the libs might register on the default registry.
export const metricsRegistry = new Registry()

// Standard process metrics: heap, RSS, GC, event loop lag, etc.
// 5s scrape interval mirrors typical Prometheus scrape cadence.
collectDefaultMetrics({ register: metricsRegistry })

// ── Engine metrics ────────────────────────────────────────────────────

export const otcTicksEmittedTotal = new Counter({
  name: 'otc_ticks_emitted_total',
  help: 'Total OTC price ticks emitted by the engine, per asset.',
  labelNames: ['assetId'] as const,
  registers: [metricsRegistry],
})

export const otcCandlesFinalizedTotal = new Counter({
  name: 'otc_candles_finalized_total',
  help: 'Total OTC candles finalized (rolled over) by the engine.',
  labelNames: ['assetId', 'timeframe'] as const,
  registers: [metricsRegistry],
})

export const otcRegimeTransitionsTotal = new Counter({
  name: 'otc_regime_transitions_total',
  help: 'Total FSM regime transitions, labelled by from/to regime.',
  labelNames: ['assetId', 'from', 'to'] as const,
  registers: [metricsRegistry],
})

export const otcEngineAssetsLoaded = new Gauge({
  name: 'otc_engine_assets_loaded',
  help: 'Number of OTC assets currently loaded in the engine.',
  registers: [metricsRegistry],
})

export const otcEngineRunning = new Gauge({
  name: 'otc_engine_running',
  help: 'Whether the OTC engine is running (1) or stopped (0).',
  registers: [metricsRegistry],
})

export const otcPriceCurrent = new Gauge({
  name: 'otc_price_current',
  help: 'Current smoothed price per OTC asset.',
  labelNames: ['assetId'] as const,
  registers: [metricsRegistry],
})

export const otcPendingTicksSize = new Gauge({
  name: 'otc_pending_ticks_size',
  help: 'Pending ticks waiting for the next batch INSERT to otc_ticks.',
  registers: [metricsRegistry],
})

export const otcPendingCandlesSize = new Gauge({
  name: 'otc_pending_candles_size',
  help: 'Pending finalized candles waiting for the next batch INSERT.',
  registers: [metricsRegistry],
})

// ── Storage metrics ───────────────────────────────────────────────────

// Buckets cover the realistic range for our queries: sub-ms (cached
// reads) up to several seconds (pool starvation tail). Match Prometheus
// histogram conventions — log-spaced.
const DB_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export const otcDbQueryDurationSeconds = new Histogram({
  name: 'otc_db_query_duration_seconds',
  help: 'Duration of OTC-related DB operations, labelled by operation name.',
  labelNames: ['op'] as const,
  buckets: DB_DURATION_BUCKETS,
  registers: [metricsRegistry],
})

export const otcDbQueryErrorsTotal = new Counter({
  name: 'otc_db_query_errors_total',
  help: 'Total OTC-related DB operation errors, by operation name.',
  labelNames: ['op'] as const,
  registers: [metricsRegistry],
})

// ── Stream metrics ────────────────────────────────────────────────────

export const otcSseClients = new Gauge({
  name: 'otc_sse_clients',
  help: 'Number of currently connected OTC SSE clients.',
  registers: [metricsRegistry],
})

export const otcSseEventsEmittedTotal = new Counter({
  name: 'otc_sse_events_emitted_total',
  help: 'Total SSE events emitted to clients, by event type.',
  labelNames: ['type'] as const,    // tick | candle | candleUpdate
  registers: [metricsRegistry],
})

export const otcSseEventsSkippedTotal = new Counter({
  name: 'otc_sse_events_skipped_total',
  help: 'SSE events skipped before send, by reason (backpressure|throttle).',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
})

// ── HTTP metrics ──────────────────────────────────────────────────────

const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request handler duration in seconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: HTTP_BUCKETS,
  registers: [metricsRegistry],
})

// ── Helper: time an async DB op + record duration + count errors ──────

/**
 * Wrap an async DB operation with metrics. Records duration regardless
 * of success/failure; increments the error counter only on failure.
 * Re-throws so the caller still sees the error.
 *
 * Usage:
 *   const result = await timedDbOp('snapshot_flush', () => flushSnapshot())
 */
export async function timedDbOp<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const end = otcDbQueryDurationSeconds.startTimer({ op })
  try {
    return await fn()
  } catch (err) {
    otcDbQueryErrorsTotal.inc({ op })
    throw err
  } finally {
    end()
  }
}
