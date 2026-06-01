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
import { applyMicroDynamics } from './microdynamics.js'

// Fase 5 naturalidade — set OTC_NATURAL_V2=false to disable all of
// pullback / micro pullback / session multiplier / counter-trend
// spike bias / strengthened liquidity bias. Useful for A/B during
// rollout. Default ON.
const NATURAL_V2 = process.env.OTC_NATURAL_V2 !== 'false'

// Per-tick chance of starting a "pullback" cycle during a trend.
// 2026-05-25 bumped 0.005 → 0.025 (5× more frequent ~ 1 per 4s) and
// duration extended so M1 candles in strong trends consistently show
// mid-trend rejection wicks instead of marching as solid bodies. Was
// previously ~1 per 20s, which left 3-4 candles between counter-moves
// — the "staircase" pattern the founder flagged on the chart.
const PULLBACK_TRIGGER_CHANCE  = 0.025
// Pullback duration range (ticks). Was 10-30 (1-3s). Stretched to
// 15-45 ticks (1.5-4.5s) so each counter-move carves a visible wick
// AND occasionally drags into a body reversal.
const PULLBACK_MIN_TICKS       = 15
const PULLBACK_MAX_TICKS       = 45
// During a pullback, drift is flipped and amplified. Was -1.5×; bumped
// to -2.0× so the counter-move is strong enough to register as a
// distinct rejection (visible wick at minimum, occasionally a small
// reversal candle) against the macro trend.
const PULLBACK_DRIFT_MULT      = -2.0

// Per-tick chance of a single-tick "micro pullback" (only counts
// when not already inside a pullback). 2% = ~12 per M1 candle. Adds
// short jagged texture INSIDE candles even between formal pullbacks.
const MICRO_PULLBACK_CHANCE    = 0.02
const MICRO_PULLBACK_MULT      = -0.6    // counter-trend, slightly stronger

// Counter-trend bias for the random spike. 70% of spikes during
// trends go AGAINST the trend, which is what creates the natural
// "rejection wick" pattern (price tests a level, gets pushed back).
const COUNTER_TREND_SPIKE_PROB = 0.7

// Boost the existing liquidity-pressure bias weight. Was 0.5 (too
// subtle to see); 1.0 doubles it but pressure is already clamped
// to [0.3, 0.7] so max contribution is ±0.4 × effectiveVol.
const LIQUIDITY_BIAS_WEIGHT    = 1.0

// Force-reversal drift (per tick) applied when the runtime detects
// 5+ consecutive same-direction M1 candles.
//
// 2026-06-01: bumped 0.00002 → 0.00006 (3×). O valor anterior (1.2%/min)
// era 6× o drift natural do TREND_UP_STRONG (0.6%/min) — dominava em
// regimes calmos mas podia ser sobrecarregado por SHOCK individual num
// regime HIGH_VOL (shock pode ser ±0.1% a 0.5% num unico tick). Com
// 0.00006 (3.6%/min de pull) o force domina ate' HIGH_VOL sem virar
// um spike artificial visivel.
const FORCE_REVERSE_DRIFT_PER_TICK = 0.00006

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
    // 2026-05-26 calibration — was 0.000015 (~0.9%/min). Cut to 0.000010
    // (~0.6%/min). Combined with the strengthened reversion below, this
    // keeps strong trends from running 40%+ off seed within 15 min.
    driftPerTick: 0.000010,
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
    // 2026-05-26 calibration — symmetric with TREND_UP_STRONG above.
    driftPerTick: -0.000010,
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

  // Force-reverse bias — set by the runtime when the M1 direction streak
  // hits 5 in a row. Dominates the regime's natural drift so the streak
  // breaks regardless of FSM state. Auto-expires after forceReverseUntilMs.
  let forceBias = 0
  if (s.forceReverseUntilMs && Date.now() < s.forceReverseUntilMs && s.forceReverseDir) {
    forceBias = (s.forceReverseDir === 'UP' ? -1 : 1) * FORCE_REVERSE_DRIFT_PER_TICK
  }

  // trendBias max ±1 → max ±0.000005 per tick = ±0.3%/min — same
  // scale as a STRONG regime drift, so a slammed bias has noticeable
  // but bounded effect, not an instant runaway.
  const drift = params.driftPerTick * effectiveDriftMult + s.trendBias * 0.000005 + forceBias

  // ── Session vol multiplier ───────────────────────────────────────
  const sessionMult = NATURAL_V2 ? sessionVolMultiplier() : 1
  const effectiveVol = s.config.volatilityBase * params.volMultiplier * s.volume * sessionMult

  // Reversion anchors the price to seed over minutes/hours. History:
  //   0.0002 → 0.0004 (M4, M4 over-corrected) → 0.00015 (Etapa B, too weak,
  //   let prices drift 40%+ off seed in 15 min — task #113) → 0.0005
  //   (2026-05-26, 3× the Etapa B strength). With reversion this strong,
  //   prices snap back toward seed by 0.3%/tick when 1% off, 30%/tick when
  //   off the catastrophic clamp — enough that strong trends bend before
  //   they break the chart's auto-scale.
  const distRatio = (s.price - s.config.seedPrice) / s.config.seedPrice
  const reversion = -0.0005 * distRatio

  // Fase M4 soft barrier; 2026-05-26 task #113 calibration: threshold
  // lowered 0.35 → 0.20 (engages MUCH earlier so prices don't get a free
  // pass past ±35%) and scale bumped 0.05 → 0.15 (3× stronger pull).
  // Combined with the strengthened reversion above, this keeps the chart
  // visually within a ±20% band most of the time. The hard clamp at ±50%
  // is now genuinely unreachable.
  //
  //   distRatio   barrier per tick    per-second pull
  //   0.20        0                   0
  //   0.25        ±0.000375           ±0.4%/sec
  //   0.30        ±0.0015             ±1.5%/sec
  //   0.40        ±0.006              ±6%/sec       (catastrophic snap-back)
  //
  // Smooth onset (= 0 at boundary) prevents the chart from "jolting"
  // the moment the barrier activates.
  let softBarrier = 0
  if (NATURAL_V2) {
    const SOFT_BARRIER_THRESHOLD = 0.20
    const SOFT_BARRIER_SCALE     = 0.15
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

  // Spike — single-tick burst that creates a wick on the live candle.
  // Etapa B: bumped rate 0.0005 → 0.0015 (3× more frequent — was 1.8/min,
  // now ~5.4/min). Magnitude dropped 1.5× → 1.0× effectiveVol so the
  // spike creates a visible wick without becoming a jump that's
  // smoothed out badly by the EMA. NATURAL_V2 biases direction 70%
  // counter-trend during trends (rejection wick pattern). Disabled
  // during the boot grace window.
  let spike = 0
  if (!s.bootGrace && rand() < 0.0015) {
    const counterTrend = NATURAL_V2 && trendDir !== 0 && rand() < COUNTER_TREND_SPIKE_PROB
    const dir = counterTrend ? -trendDir : (rand() > 0.5 ? 1 : -1)
    spike = dir * 1.0 * effectiveVol
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
  // Macro state is finalised. The MICRO layer (Fase M1-Naturalization)
  // perturbs the EMITTED price with tick-scale wiggle that creates
  // visible wicks + body variation on M1 candles. CRITICAL: do NOT
  // store this back into s.smoothedPrice — the macro EMA needs clean
  // continuity across ticks, and the micro layer has its own state
  // (mean-reverting AR(1), 5-sub-regime FSM) inside microdynamics.ts.
  // Multiplicative, mean-zero — bounded contribution well under the
  // catastrophic clamp protection enforced above on `clamped`.
  return NATURAL_V2
    ? applyMicroDynamics(s.config.id, smoothed, effectiveVol, Date.now(), rand)
    : smoothed
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
