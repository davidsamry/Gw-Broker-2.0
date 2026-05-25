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

// Fase 5 naturalidade — set OTC_NATURAL_V2=false to disable all of
// pullback / micro pullback / session multiplier / counter-trend
// spike bias / strengthened liquidity bias. Useful for A/B during
// rollout. Default ON.
const NATURAL_V2 = process.env.OTC_NATURAL_V2 !== 'false'

// Per-tick chance of starting a "pullback" cycle during a trend.
// 0.005 = 0.5%, so ~1 pullback per 200 ticks (~20s) during trending
// regimes. Lateral regimes never trigger pullbacks (no trend to
// pull back against).
const PULLBACK_TRIGGER_CHANCE  = 0.005
// Pullback duration range (ticks). 10-30 ticks = 1-3 seconds of
// counter-trend drift.
const PULLBACK_MIN_TICKS       = 10
const PULLBACK_MAX_TICKS       = 30
// During a pullback, drift is flipped and amplified to make the
// counter-move visible (1.5× the regime's normal drift, negated).
const PULLBACK_DRIFT_MULT      = -1.5

// Per-tick chance of a single-tick "micro pullback" (only counts
// when not already inside a pullback). 1% = ~6 micro pullbacks per
// 60s candle. Adds breath to otherwise-straight trend lines without
// adding noise.
const MICRO_PULLBACK_CHANCE    = 0.01
const MICRO_PULLBACK_MULT      = -0.4    // soft counter-trend

// Counter-trend bias for the random spike. 70% of spikes during
// trends go AGAINST the trend, which is what creates the natural
// "rejection wick" pattern (price tests a level, gets pushed back).
const COUNTER_TREND_SPIKE_PROB = 0.7

// Boost the existing liquidity-pressure bias weight. Was 0.5 (too
// subtle to see); 1.0 doubles it but pressure is already clamped
// to [0.3, 0.7] so max contribution is ±0.4 × effectiveVol.
const LIQUIDITY_BIAS_WEIGHT    = 1.0

// Session-based volatility multiplier — rough approximation of real
// market activity windows. Helps the chart "feel" different at
// different times of day rather than looking the same 24/7.
export function sessionVolMultiplier(now: Date = new Date()): number {
  const hour = now.getUTCHours()
  if (hour >= 13 && hour < 17) return 1.4   // NY session (peak)
  if (hour >= 7  && hour < 13) return 1.2   // London session
  if (hour >= 17 && hour < 22) return 0.8   // post-NY tail
  if (hour >= 0  && hour < 6)  return 0.7   // Asian (low)
  return 1.0                                 // transition zones
}

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
    // Fase 5: EXPANSION weight bumped 20→35 so compression more
    // reliably leads to a visible breakout. Compression-then-
    // expansion is a textbook market pattern; engine should reflect it.
    transitions: {
      LATERAL: 25, COMPRESSION: 10, EXPANSION: 35,
      LOW_VOL: 10, TREND_UP_WEAK: 10, TREND_DOWN_WEAK: 10,
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
//
// Fase 5 layered on top of the basic random walk:
//   • Pullback FSM:    1-3s counter-trend bursts ~0.5%/tick during trends
//   • Micro pullback:  single-tick soft counter-move, ~1%/tick
//   • Session mult:    UTC-hour-driven vol bump (NY peak, Asian low)
//   • Spike bias:      70% of spikes go counter-trend → rejection wicks
//   • Liquidity bias:  weight bumped 0.5 → 1.0 (still pressure-clamped)
//
// All bounded by the existing clamp [seed*0.5, seed*2]. Disabling via
// OTC_NATURAL_V2=false reverts to plain random walk for A/B testing.
export function stepPrice(s: OtcAssetState, rand: () => number = Math.random): number {
  const params = REGIME_PARAMS[s.regime]
  const trendDir = params.driftPerTick > 0 ? 1 : params.driftPerTick < 0 ? -1 : 0

  // ── Pullback FSM (overrides drift for the pullback duration) ─────
  let effectiveDriftMult = 1   // applied to params.driftPerTick
  if (NATURAL_V2 && trendDir !== 0) {
    if (s.pullbackTicksRemaining && s.pullbackTicksRemaining > 0) {
      effectiveDriftMult = PULLBACK_DRIFT_MULT  // counter-trend, amplified
      s.pullbackTicksRemaining--
    } else if (rand() < PULLBACK_TRIGGER_CHANCE) {
      // Start a new pullback. First tick of it runs immediately.
      s.pullbackTicksRemaining = PULLBACK_MIN_TICKS +
        Math.floor(rand() * (PULLBACK_MAX_TICKS - PULLBACK_MIN_TICKS))
      effectiveDriftMult = PULLBACK_DRIFT_MULT
      s.pullbackTicksRemaining--
    } else if (rand() < MICRO_PULLBACK_CHANCE) {
      // Single-tick soft counter-move. Doesn't compound into pullback.
      effectiveDriftMult = MICRO_PULLBACK_MULT
    }
  }

  // trendBias max ±1 → max ±0.000005 per tick = ±0.3%/min — same
  // scale as a STRONG regime drift, so a slammed bias has noticeable
  // but bounded effect, not an instant runaway.
  const drift = params.driftPerTick * effectiveDriftMult + s.trendBias * 0.000005

  // ── Session vol multiplier ───────────────────────────────────────
  const sessionMult = NATURAL_V2 ? sessionVolMultiplier() : 1
  const effectiveVol = s.config.volatilityBase * params.volMultiplier * s.volume * sessionMult

  // Reversion anchors the price to seed over minutes/hours. Bumped
  // 0.0002 → 0.0004 (May 2026) after observing prod runaway where the
  // engine drifted to ±50% of seed under sustained STRONG trend chains.
  // Math: at max deviation (price = seed × 2), reversion contribution
  // is -0.0004/tick = -0.04%/tick = -24%/min back toward seed —
  // dominates any single shock and any STRONG regime drift, while still
  // leaving room for visible candle bodies during normal regimes.
  const distRatio = (s.price - s.config.seedPrice) / s.config.seedPrice
  const reversion = -0.0004 * distRatio

  // Fase M4 — soft barrier. The hard clamp at [seed×0.5, seed×2]
  // creates an ugly visual "stick" when price runs into it (the BTC
  // seedPrice × 0.5 = 34001 incident this week). Instead of relying
  // only on the hard cap, layer in a progressive force that engages
  // when |distRatio| > 0.3 and grows quadratically toward the clamp.
  //
  //   distRatio   barrier per tick    per-second pull
  //   0.30        0                   0
  //   0.40        ±0.0005             ±0.5%/sec
  //   0.45        ±0.001125           ±1.1%/sec
  //   0.50        ±0.002              ±2%/sec   ← dominates any shock
  //
  // The hard clamp stays as a safety net but should now rarely engage
  // in normal operation. Smooth onset (= 0 at boundary) prevents the
  // chart from "jolting" the moment the barrier activates.
  let softBarrier = 0
  if (NATURAL_V2) {
    const SOFT_BARRIER_THRESHOLD = 0.3
    const SOFT_BARRIER_SCALE     = 0.05
    const absDist = Math.abs(distRatio)
    if (absDist > SOFT_BARRIER_THRESHOLD) {
      const over = absDist - SOFT_BARRIER_THRESHOLD
      const sign = distRatio > 0 ? 1 : -1
      softBarrier = -sign * over * over * SOFT_BARRIER_SCALE
    }
  }

  const shock        = gaussian(0, effectiveVol, rand)
  // Liquidity bias — stronger weight under NATURAL_V2 to make
  // pressure differentials visible in the price action.
  const liqWeight     = NATURAL_V2 ? LIQUIDITY_BIAS_WEIGHT : 0.5
  const liquidityBias = liqWeight * (s.buyPressure - s.sellPressure) * effectiveVol

  // Spike — rare news-event discontinuity. NATURAL_V2 biases direction
  // 70% counter-trend during trends (rejection wick pattern). Disabled
  // during the boot grace window.
  let spike = 0
  if (!s.bootGrace && rand() < 0.0005) {
    const counterTrend = NATURAL_V2 && trendDir !== 0 && rand() < COUNTER_TREND_SPIKE_PROB
    const dir = counterTrend ? -trendDir : (rand() > 0.5 ? 1 : -1)
    spike = dir * 1.5 * effectiveVol
  }

  const rawNext = s.price * (1 + drift + reversion + softBarrier + shock + liquidityBias + spike)
  // Catastrophic protection — never wander beyond half/double the seed.
  // With M4 soft barrier, this should rarely engage in normal operation
  // (it kicks in only on extreme shocks the soft barrier couldn't catch).
  const clamped = clamp(rawNext, s.config.seedPrice * 0.5, s.config.seedPrice * 2)

  // EMA smoothing (alpha = 0.6) — consecutive ticks are correlated
  // enough to keep the chart line continuous, but not so smoothed that
  // intra-candle high/low collapse onto open/close (which was the
  // 2026-05-25 "repetitive candles + no wicks" complaint at α=0.3).
  // Higher alpha = more weight on the new tick = bigger candle bodies
  // and visible wicks because max/min within a candle actually diverge
  // from the close.
  const smoothed = 0.6 * clamped + 0.4 * s.smoothedPrice

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
