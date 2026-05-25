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
// Nothing in this file touches I/O — it's pure math. The runtime is the
// only place that calls `stepPrice` / `maybeTransitionRegime` / etc.
// That separation makes the engine trivial to unit-test.
//
// Fase 4: moved from ../pricingEngine.ts. Old path kept as a re-export
// shim for back-compat.

import type { OtcAssetState, OtcRegime } from '../types.js'

// ── Regime parameters ──────────────────────────────────────────────────
interface RegimeParams {
  driftPerTick:  number
  volMultiplier: number
  durMinMs:      number
  durMaxMs:      number
  transitions:   Partial<Record<OtcRegime, number>>   // weights, not normalized
}

// Calibration notes (May 2026):
//   • driftPerTick was 16× too big — TREND_UP_STRONG at 0.00025/tick =
//     +15%/min, which produced 5-15% candle bodies on prod. New values
//     target +0.3% per min for WEAK and +0.9% for STRONG.
//   • Durations bumped for LATERAL/WEAK (longer calm stretches),
//     trimmed for STRONG/HIGH_VOL (these regimes should be brief
//     bursts, not sustained moves).
//   • Transition weights rebalanced toward LATERAL — by far the most
//     common real-market state.
//
// Quick mental math: drift_per_minute ≈ driftPerTick × 600.
export const REGIME_PARAMS: Record<OtcRegime, RegimeParams> = {
  LATERAL: {
    // LATERAL should still feel alive — same volMultiplier as a WEAK
    // trend, just no directional drift. Duration trimmed so the engine
    // doesn't sit in a calm period for 4 minutes at a time.
    driftPerTick: 0,
    volMultiplier: 1.0,
    durMinMs:  30_000, durMaxMs: 90_000,
    transitions: {
      LATERAL: 20, TREND_UP_WEAK: 22, TREND_DOWN_WEAK: 22,
      HIGH_VOL: 8,  LOW_VOL: 8, COMPRESSION: 8, EXPANSION: 12,
    },
  },
  TREND_UP_WEAK: {
    driftPerTick: 0.000005,        // ~0.3% per minute
    volMultiplier: 1.0,
    durMinMs: 30_000, durMaxMs: 90_000,
    transitions: {
      LATERAL: 45, TREND_UP_WEAK: 20, TREND_UP_STRONG: 10,
      TREND_DOWN_WEAK: 10, HIGH_VOL: 3, COMPRESSION: 12,
    },
  },
  TREND_UP_STRONG: {
    driftPerTick: 0.000015,        // ~0.9% per minute
    volMultiplier: 1.2,
    durMinMs: 10_000, durMaxMs: 30_000,
    transitions: {
      LATERAL: 30, TREND_UP_WEAK: 45, TREND_UP_STRONG: 5,
      TREND_DOWN_WEAK: 10, HIGH_VOL: 3, COMPRESSION: 7,
    },
  },
  TREND_DOWN_WEAK: {
    driftPerTick: -0.000005,
    volMultiplier: 1.0,
    durMinMs: 30_000, durMaxMs: 90_000,
    transitions: {
      LATERAL: 45, TREND_DOWN_WEAK: 20, TREND_DOWN_STRONG: 10,
      TREND_UP_WEAK: 10, HIGH_VOL: 3, COMPRESSION: 12,
    },
  },
  TREND_DOWN_STRONG: {
    driftPerTick: -0.000015,
    volMultiplier: 1.2,
    durMinMs: 10_000, durMaxMs: 30_000,
    transitions: {
      LATERAL: 30, TREND_DOWN_WEAK: 45, TREND_DOWN_STRONG: 5,
      TREND_UP_WEAK: 10, HIGH_VOL: 3, COMPRESSION: 7,
    },
  },
  HIGH_VOL: {
    driftPerTick: 0,
    volMultiplier: 1.4,
    durMinMs: 8_000, durMaxMs: 20_000,
    transitions: {
      LATERAL: 50, EXPANSION: 12, COMPRESSION: 18,
      TREND_UP_WEAK: 8, TREND_DOWN_WEAK: 8, HIGH_VOL: 4,
    },
  },
  LOW_VOL: {
    driftPerTick: 0,
    volMultiplier: 0.5,
    durMinMs: 60_000, durMaxMs: 180_000,
    transitions: {
      LATERAL: 50, LOW_VOL: 25, COMPRESSION: 15,
      TREND_UP_WEAK: 5, TREND_DOWN_WEAK: 5,
    },
  },
  COMPRESSION: {
    driftPerTick: 0,
    volMultiplier: 0.6,
    durMinMs: 30_000, durMaxMs: 90_000,
    transitions: {
      LATERAL: 35, COMPRESSION: 15, EXPANSION: 20,
      LOW_VOL: 15, TREND_UP_WEAK: 7, TREND_DOWN_WEAK: 8,
    },
  },
  EXPANSION: {
    driftPerTick: 0,
    volMultiplier: 1.3,
    durMinMs: 10_000, durMaxMs: 30_000,
    transitions: {
      LATERAL: 35, EXPANSION: 5, HIGH_VOL: 15,
      TREND_UP_WEAK: 18, TREND_DOWN_WEAK: 18, COMPRESSION: 9,
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
// Mutates the asset state in place. Returns true when transition fires.
export function maybeTransitionRegime(s: OtcAssetState, nowMs: number, rand: () => number = Math.random): boolean {
  if (nowMs - s.regimeStartedAt < s.regimeDurationMs) return false
  const next = pickNextRegime(s.regime, rand)
  s.regime           = next
  s.regimeStartedAt  = nowMs
  s.regimeDurationMs = pickRegimeDurationMs(next, rand)
  return true
}

// ── Liquidity update ───────────────────────────────────────────────────
// Slow random walk — called every ~10s by the runtime. Keeps the order-
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

  // trendBias max ±1 → max ±0.000005 per tick = ±0.3%/min — same
  // scale as a STRONG regime drift, so a slammed bias has noticeable
  // but bounded effect, not an instant runaway.
  const drift        = params.driftPerTick + s.trendBias * 0.000005
  const effectiveVol = s.config.volatilityBase * params.volMultiplier * s.volume
  // Reversion was -0.0008 (strong snap-back). At -0.0002 it still
  // anchors the price to seed over minutes/hours without producing
  // the violent reversion candles we saw post-deploy when the engine
  // restarted far from seed.
  const reversion    = -0.0002 * (s.price - s.config.seedPrice) / s.config.seedPrice
  const shock        = gaussian(0, effectiveVol, rand)
  const liquidityBias = 0.5 * (s.buyPressure - s.sellPressure) * effectiveVol
  // Spike: rare news-event-style discontinuity. Frequency cut in half
  // (0.001 → 0.0005) and magnitude halved (3× → 1.5×) so spikes are
  // visible but no longer dominate the chart. Disabled during the
  // boot grace window so the first ticks after restart never introduce
  // a discontinuity that would look like a deploy-time gap to the user.
  const spike        = !s.bootGrace && rand() < 0.0005
    ? (rand() > 0.5 ? 1 : -1) * 1.5 * effectiveVol
    : 0

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
