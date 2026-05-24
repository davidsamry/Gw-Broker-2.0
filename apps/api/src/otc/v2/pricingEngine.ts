// OTC v2 pricing engine — the brain that produces one tick of price
// movement per call. Composed of three layers:
//
//   1. Regime FSM (Markov-style transitions over 9 market states).
//      Each regime sets baseline drift + volatility for its duration.
//   2. Liquidity model (spread / pressure / volume) — slow-moving,
//      modulates how the regime's instructions translate to actual ticks.
//   3. Per-tick stochastic step: drift + mean-reversion + gaussian shock
//      + occasional spike, then EMA-smoothed for visual continuity.
//
// Nothing in this file touches I/O — it's pure math. The worker is the
// only place that calls `stepPrice` / `maybeTransitionRegime` / etc.
// That separation makes the engine trivial to unit-test later.

import type { OtcAssetState, OtcRegime } from './types.js'

// ── Regime parameters ──────────────────────────────────────────────────
// Each regime is a (driftPerTick, volMultiplier, duration range,
// transition probabilities) tuple. Values tuned by feel — calmer states
// stick around longer, volatile states burn out fast. Transitions are
// asymmetric: you usually cool down from a strong trend to weak, then
// to lateral, before reversing — same as real markets.

interface RegimeParams {
  driftPerTick:  number
  volMultiplier: number
  durMinMs:      number
  durMaxMs:      number
  transitions:   Partial<Record<OtcRegime, number>>   // weights, not normalized
}

export const REGIME_PARAMS: Record<OtcRegime, RegimeParams> = {
  LATERAL: {
    driftPerTick: 0,
    volMultiplier: 0.8,
    durMinMs:  30_000, durMaxMs: 120_000,
    transitions: {
      LATERAL: 20, TREND_UP_WEAK: 20, TREND_DOWN_WEAK: 20,
      HIGH_VOL: 8,  LOW_VOL: 12, COMPRESSION: 10, EXPANSION: 10,
    },
  },
  TREND_UP_WEAK: {
    driftPerTick: 0.00008,
    volMultiplier: 1.0,
    durMinMs: 20_000, durMaxMs: 80_000,
    transitions: {
      LATERAL: 30, TREND_UP_WEAK: 25, TREND_UP_STRONG: 20,
      TREND_DOWN_WEAK: 10, HIGH_VOL: 5, COMPRESSION: 10,
    },
  },
  TREND_UP_STRONG: {
    driftPerTick: 0.00025,
    volMultiplier: 1.3,
    durMinMs: 15_000, durMaxMs: 45_000,
    transitions: {
      LATERAL: 20, TREND_UP_WEAK: 35, TREND_UP_STRONG: 15,
      TREND_DOWN_WEAK: 15, HIGH_VOL: 5, COMPRESSION: 10,
    },
  },
  TREND_DOWN_WEAK: {
    driftPerTick: -0.00008,
    volMultiplier: 1.0,
    durMinMs: 20_000, durMaxMs: 80_000,
    transitions: {
      LATERAL: 30, TREND_DOWN_WEAK: 25, TREND_DOWN_STRONG: 20,
      TREND_UP_WEAK: 10, HIGH_VOL: 5, COMPRESSION: 10,
    },
  },
  TREND_DOWN_STRONG: {
    driftPerTick: -0.00025,
    volMultiplier: 1.3,
    durMinMs: 15_000, durMaxMs: 45_000,
    transitions: {
      LATERAL: 20, TREND_DOWN_WEAK: 35, TREND_DOWN_STRONG: 15,
      TREND_UP_WEAK: 15, HIGH_VOL: 5, COMPRESSION: 10,
    },
  },
  HIGH_VOL: {
    driftPerTick: 0,
    volMultiplier: 1.8,
    durMinMs: 10_000, durMaxMs: 30_000,
    transitions: {
      LATERAL: 30, EXPANSION: 20, COMPRESSION: 20,
      TREND_UP_WEAK: 12, TREND_DOWN_WEAK: 12, HIGH_VOL: 6,
    },
  },
  LOW_VOL: {
    driftPerTick: 0,
    volMultiplier: 0.5,
    durMinMs: 30_000, durMaxMs: 120_000,
    transitions: {
      LATERAL: 40, LOW_VOL: 20, COMPRESSION: 20,
      TREND_UP_WEAK: 10, TREND_DOWN_WEAK: 10,
    },
  },
  COMPRESSION: {
    driftPerTick: 0,
    volMultiplier: 0.6,
    durMinMs: 20_000, durMaxMs: 60_000,
    transitions: {
      LATERAL: 20, COMPRESSION: 15, EXPANSION: 30,
      LOW_VOL: 10, TREND_UP_WEAK: 12, TREND_DOWN_WEAK: 13,
    },
  },
  EXPANSION: {
    driftPerTick: 0,
    volMultiplier: 1.6,
    durMinMs: 15_000, durMaxMs: 45_000,
    transitions: {
      LATERAL: 20, EXPANSION: 10, HIGH_VOL: 20,
      TREND_UP_WEAK: 20, TREND_DOWN_WEAK: 20, COMPRESSION: 10,
    },
  },
}

// Pick the next regime via weighted-random over the current's transition
// table. Pure function; caller supplies rand for deterministic tests.
export function pickNextRegime(current: OtcRegime, rand: () => number = Math.random): OtcRegime {
  const trans = REGIME_PARAMS[current].transitions
  const entries = Object.entries(trans) as Array<[OtcRegime, number]>
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [regime, weight] of entries) {
    r -= weight
    if (r <= 0) return regime
  }
  return current
}

export function pickRegimeDurationMs(regime: OtcRegime, rand: () => number = Math.random): number {
  const p = REGIME_PARAMS[regime]
  return p.durMinMs + rand() * (p.durMaxMs - p.durMinMs)
}

// If the current regime has run its course, transition to the next one.
// Mutates the asset state in place. Returns true when transition fires
// (worker logs / persists state then).
export function maybeTransitionRegime(s: OtcAssetState, nowMs: number, rand: () => number = Math.random): boolean {
  if (nowMs - s.regimeStartedAt < s.regimeDurationMs) return false
  const next = pickNextRegime(s.regime, rand)
  s.regime           = next
  s.regimeStartedAt  = nowMs
  s.regimeDurationMs = pickRegimeDurationMs(next, rand)
  return true
}

// ── Liquidity update ───────────────────────────────────────────────────
// Slow random walk — called every ~10s by the worker. Keeps the order-
// book "feel" alive without per-tick churn.
export function stepLiquidity(s: OtcAssetState, rand: () => number = Math.random): void {
  s.spread       = clamp(s.spread       + (rand() - 0.5) * 0.00003, 0.00005, 0.001)
  s.buyPressure  = clamp(s.buyPressure  + (rand() - 0.5) * 0.05,    0.3,     0.7)
  s.sellPressure = 1 - s.buyPressure  // mirror
  s.volume       = clamp(s.volume       + (rand() - 0.5) * 0.1,     0.5,     2.0)
  s.depth        = clamp(s.depth        + (rand() - 0.5) * 0.05,    0.5,     2.0)
  s.speed        = clamp(s.speed        + (rand() - 0.5) * 0.03,    0.7,     1.5)
}

// ── Per-tick price step ────────────────────────────────────────────────
// price_t+1 = price_t × (1 + drift + reversion + shock + liquidityBias + spike)
// then EMA smoothed and clamped.
export function stepPrice(s: OtcAssetState, rand: () => number = Math.random): number {
  const params = REGIME_PARAMS[s.regime]

  const drift        = params.driftPerTick + s.trendBias * 0.0001
  const effectiveVol = s.config.volatilityBase * params.volMultiplier * s.volume
  const reversion    = -0.0008 * (s.price - s.config.seedPrice) / s.config.seedPrice
  const shock        = gaussian(0, effectiveVol, rand)
  const liquidityBias = 0.5 * (s.buyPressure - s.sellPressure) * effectiveVol
  const spike        = rand() < 0.001 ? (rand() > 0.5 ? 1 : -1) * 3 * effectiveVol : 0

  const rawNext = s.price * (1 + drift + reversion + shock + liquidityBias + spike)
  // Catastrophic protection — never wander beyond half/double the seed.
  const clamped = clamp(rawNext, s.config.seedPrice * 0.5, s.config.seedPrice * 2)

  // EMA smoothing (alpha = 0.3) — consecutive ticks are correlated, which
  // is what makes the chart line look like a market chart instead of TV
  // static.
  const smoothed = 0.3 * clamped + 0.7 * s.smoothedPrice

  s.price         = clamped
  s.smoothedPrice = smoothed
  return smoothed
}

// ── Helpers ────────────────────────────────────────────────────────────
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

// Box-Muller. Std should be set such that ±3*std is the worst single-tick
// move you'd see in normal volatility.
function gaussian(mean: number, std: number, rand: () => number): number {
  const u = 1 - rand()
  const v = rand()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return mean + z * std
}
