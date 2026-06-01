// Fase 4 — boot-time state recovery. The chain of fallbacks that
// decides where the engine resumes its `price` + `smoothedPrice` +
// regime + liquidity from. See Fase 2/3 commits for the rationale.

import type { OtcAssetConfig, OtcAssetState, OtcCandle, OtcRegime } from '../types.js'
import { OTC_TIMEFRAMES } from '../types.js'
import { pickRegimeDurationMs } from '../engine/pricing.js'
import type { LatestTickInfo } from '../storage/ticks.js'
import type { EngineSnapshot } from '../storage/snapshot.js'
import { CURRENT_SNAPSHOT_VERSION, SNAPSHOT_MAX_AGE_MS } from '../storage/snapshot.js'
import type { PersistedRuntimeState } from '../storage/state.js'

// Fase 2/3 — what source the recovered price came from. Used only for
// structured boot logging; doesn't affect engine behavior.
export type StartPriceSource =
  | 'snapshot'                        // Fase 3 deterministic snapshot (best)
  | 'tick'                            // latest otc_ticks row (freshest)
  | 'candle-tf5' | 'candle-tf15'      // most-recent candle across tfs
  | 'candle-tf30' | 'candle-tf60'
  | 'candle-tf300'
  | 'seed'                            // last resort — no history at all

export interface InitialStateResult {
  state:         OtcAssetState
  source:        StartPriceSource
  lastTickAt:    Date | null
  lastCandleAt:  Date | null
  // When a snapshot was rejected, the reasons. Empty when snapshot was
  // valid OR not present at all. Logged so an operator can see why the
  // chain fell through.
  snapshotRejectReasons: string[]
}

// Stateful resume: prefers (Fase 3) a valid deterministic snapshot
// over re-derived state. Fall-through order on snapshot reject:
//   snapshot → latest tick → most recent candle (any tf) → seedPrice.
// NEVER falls back to seedPrice if any history exists for the asset.
export function buildInitialState(
  cfg:             OtcAssetConfig,
  latestCandles:   Map<string, OtcCandle | null>,
  persisted?:      PersistedRuntimeState,
  latestTick?:     LatestTickInfo | null,
  snapshot?:       EngineSnapshot | null,
): InitialStateResult {
  // ── Source 0 (PRIMARY): valid snapshot — atomic restore ────────────
  const snapshotRejectReasons: string[] = []
  if (snapshot) {
    const v = isSnapshotValid(snapshot, cfg)
    if (v.valid) {
      const now = Date.now()
      const elapsed = now - snapshot.regimeStartedAt.getTime()
      const remaining = snapshot.regimeDurationMs - elapsed
      const regimeRunway = remaining > 5_000
      return {
        state: {
          config:           cfg,
          price:            snapshot.currentPrice,
          smoothedPrice:    snapshot.smoothedPrice,
          regime:           regimeRunway ? snapshot.regime : 'LATERAL',
          regimeStartedAt:  regimeRunway ? snapshot.regimeStartedAt.getTime() : now,
          regimeDurationMs: regimeRunway ? snapshot.regimeDurationMs : pickRegimeDurationMs('LATERAL'),
          spread:           snapshot.spread,
          buyPressure:      snapshot.buyPressure,
          sellPressure:     snapshot.sellPressure,
          volume:           snapshot.volume,
          depth:            snapshot.depth,
          speed:            snapshot.speed,
          trendBias:        snapshot.trendBias,
          lastTickAt:       snapshot.lastTickTime?.getTime(),
          lastCandleAt:     snapshot.lastCandleTime?.getTime(),
          // 2026-06-01: persist M1 streak state pra continuar a regra
          // de "max 5 velas iguais" atravessando restart. Sem isso, o
          // counter zerava e o sistema podia perder a contagem.
          m1DirectionStreak:   snapshot.m1DirectionStreak ?? 0,
          m1LastDirection:     snapshot.m1LastDirection ?? undefined,
          forceReverseUntilMs: snapshot.forceReverseUntilAt?.getTime(),
          forceReverseDir:     snapshot.forceReverseDir ?? undefined,
          forceNextCandleDir:  snapshot.forceNextCandleDir ?? undefined,
        },
        source:                'snapshot',
        lastTickAt:            snapshot.lastTickTime ?? latestTick?.recordedAt ?? null,
        lastCandleAt:          snapshot.lastCandleTime ?? null,
        snapshotRejectReasons: [],
      }
    }
    snapshotRejectReasons.push(...v.reasons)
  }

  // ── Source 1: most recent candle across ALL timeframes ─────────────
  let bestCandle: OtcCandle | null = null
  let bestSource: StartPriceSource = 'seed'
  for (const tf of OTC_TIMEFRAMES) {
    const c = latestCandles.get(`${cfg.id}:${tf}`)
    if (!c) continue
    if (!bestCandle || c.openTime.getTime() > bestCandle.openTime.getTime()) {
      bestCandle = c
      bestSource = `candle-tf${tf}` as StartPriceSource
    }
  }

  // ── Pick start price by freshness ──────────────────────────────────
  let startPrice: number
  let source: StartPriceSource
  if (
    latestTick &&
    (!bestCandle || latestTick.recordedAt.getTime() > bestCandle.openTime.getTime())
  ) {
    startPrice = latestTick.price
    source     = 'tick'
  } else if (bestCandle) {
    startPrice = bestCandle.close
    source     = bestSource
  } else {
    startPrice = cfg.seedPrice
    source     = 'seed'
  }

  // ── Regime — resume from persisted state if still has runway ───────
  let regime: OtcRegime = 'LATERAL'
  let regimeStartedAt   = Date.now()
  let regimeDurationMs  = pickRegimeDurationMs(regime)
  if (persisted?.regime && persisted.regimeStartedAt) {
    const elapsed = Date.now() - persisted.regimeStartedAt.getTime()
    const remaining = (persisted.regimeDurationS ?? 60) * 1000 - elapsed
    if (remaining > 5_000) {
      regime           = persisted.regime
      regimeStartedAt  = persisted.regimeStartedAt.getTime()
      regimeDurationMs = (persisted.regimeDurationS ?? 60) * 1000
    }
  }

  return {
    state: {
      config:           cfg,
      price:            startPrice,
      smoothedPrice:    startPrice,
      regime,
      regimeStartedAt,
      regimeDurationMs,
      spread:           persisted?.spread       ?? 0.0001,
      buyPressure:      persisted?.buyPressure  ?? 0.5,
      sellPressure:     persisted?.sellPressure ?? 0.5,
      volume:           persisted?.volume       ?? 1.0,
      depth:            persisted?.depth        ?? 1.0,
      speed:            persisted?.speed        ?? 1.0,
      trendBias:        persisted?.trendBias    ?? 0,
      lastTickAt:       latestTick?.recordedAt.getTime(),
      lastCandleAt:     bestCandle?.openTime.getTime(),
    },
    source,
    lastTickAt:            latestTick?.recordedAt ?? null,
    lastCandleAt:          bestCandle?.openTime   ?? null,
    snapshotRejectReasons,
  }
}

// Validate a snapshot before trusting it. Rejection reasons are
// returned so the boot log can show WHY the snapshot was ignored.
export function isSnapshotValid(snap: EngineSnapshot, cfg: OtcAssetConfig): {
  valid: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  if (snap.snapshotVersion !== CURRENT_SNAPSHOT_VERSION) {
    reasons.push(`version=${snap.snapshotVersion}!=${CURRENT_SNAPSHOT_VERSION}`)
  }
  const ageMs = Date.now() - snap.updatedAt.getTime()
  if (ageMs > SNAPSHOT_MAX_AGE_MS) {
    reasons.push(`age=${Math.floor(ageMs / 1000)}s>${SNAPSHOT_MAX_AGE_MS / 1000}s`)
  }
  const minP = cfg.seedPrice * 0.5
  const maxP = cfg.seedPrice * 2
  if (!Number.isFinite(snap.currentPrice) || snap.currentPrice < minP || snap.currentPrice > maxP) {
    reasons.push(`currentPrice=${snap.currentPrice}∉[${minP},${maxP}]`)
  }
  if (!Number.isFinite(snap.smoothedPrice) || snap.smoothedPrice < minP || snap.smoothedPrice > maxP) {
    reasons.push(`smoothedPrice=${snap.smoothedPrice}∉[${minP},${maxP}]`)
  }
  if (snap.buyPressure < 0 || snap.buyPressure > 1) reasons.push(`buyPressure=${snap.buyPressure}`)
  if (snap.sellPressure < 0 || snap.sellPressure > 1) reasons.push(`sellPressure=${snap.sellPressure}`)
  if (snap.spread < 0 || snap.spread > 1) reasons.push(`spread=${snap.spread}`)
  if (snap.trendBias < -1 || snap.trendBias > 1) reasons.push(`trendBias=${snap.trendBias}`)
  if (snap.regimeDurationMs <= 0 || snap.regimeDurationMs > 10 * 60_000) {
    reasons.push(`regimeDurationMs=${snap.regimeDurationMs}`)
  }
  return { valid: reasons.length === 0, reasons }
}
