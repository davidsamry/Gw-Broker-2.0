// Fase 4 — single source of truth for the engine's in-memory state.
// Every other module (engine/storage/recovery/admin) imports the Maps
// from here so there's only one instance per process. Previously these
// were module-level variables in worker.ts; pulling them out lets the
// rest split cleanly without circular imports.

import type { OtcAssetConfig, OtcAssetState, OtcCandle, OtcTick } from '../types.js'
import { CANDLES_PER_TF } from '../types.js'
import { CandleBuilder } from '../engine/candle-builder.js'

// ── Shared maps ────────────────────────────────────────────────────────
// One OtcAssetState per asset. Mutated 10×/sec by the tick loop.
export const assetStates = new Map<string, OtcAssetState>()
// 5 builders per asset (one per timeframe). Replaced wholesale on
// reloadOtcV2Assets when a new asset appears live.
export const builders    = new Map<string, CandleBuilder[]>()
// Ring buffer per (assetId:tf), capped at CANDLES_PER_TF. Served by
// the /otc/v2/candles REST endpoint with zero DB hit.
export const candleCache = new Map<string, OtcCandle[]>()

// ── Pending write buffers ──────────────────────────────────────────────
// Tick loop pushes here; runtime/loops.ts flushes every TICK_FLUSH_INTERVAL_MS.
export const pendingTicks:   OtcTick[]   = []
export const pendingCandles: OtcCandle[] = []

// ── Boot lifecycle ─────────────────────────────────────────────────────
// Used by isWithinBootGrace() to suppress spikes in the first
// BOOT_SPIKE_GRACE_MS after engine start.
let bootedAt = 0
export function getBootedAt(): number { return bootedAt }
export function setBootedAt(ts: number): void { bootedAt = ts }

let isRunning = false
export function isEngineRunning(): boolean { return isRunning }
export function setEngineRunning(v: boolean): void { isRunning = v }

// ── Public read API (back-compat exports used by routes.ts) ────────────
export function getCachedCandles(assetId: string, tf: number, limit: number = CANDLES_PER_TF): OtcCandle[] {
  const buf = candleCache.get(`${assetId}:${tf}`) ?? []
  return buf.slice(-Math.min(limit, buf.length))
}

export function getCurrentPrice(assetId: string): number | null {
  const s = assetStates.get(assetId)
  return s ? round5(s.smoothedPrice) : null
}

export function listEngineAssets(): OtcAssetConfig[] {
  return Array.from(assetStates.values()).map(s => s.config)
}

// Shared rounding helper — all prices stored at 5-decimal precision
// to match the Decimal(18,5) columns in otc_ticks / otc_candles.
export function round5(v: number): number {
  return Math.round(v * 100000) / 100000
}
