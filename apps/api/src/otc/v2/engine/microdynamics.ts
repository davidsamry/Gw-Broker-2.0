// Fase OTC M1-Naturalization (2026-05-25)
//
// Micro-layer that adds tick-scale TEXTURE (wicks, body variation, micro
// pullbacks, brief consolidations) WITHOUT touching the macro logic
// (regime FSM, drift, reversion, soft barrier, EMA smoothing).
//
// Why a separate module:
//   • The existing 15m/1h candles are already visually good — they capture
//     enough macro drift to look natural. M1 was the problem: too few
//     ticks of net macro movement per minute → bodies tiny, wicks
//     collapsed onto open/close.
//   • Increasing macro volatility would fix M1 but blow up 15m/1h.
//   • A mean-reverting, fast-decay micro layer adds intra-candle "wiggle"
//     that's strongly visible at M1 (single sub-regime = visible body
//     variation) but averages out over 15m+ windows.
//
// How it works:
//   • Per-asset sub-regime FSM with 5 states (CALM/ACTIVE/CONSOLIDATION/
//     BURST/ABSORPTION). Markov transitions weighted so BURST rarely
//     follows BURST (avoids "always chaotic" feeling).
//   • Sub-regime duration: 0.8-30s (BURST is the shortest).
//   • Each sub-regime has its own (volatility multiplier, AR(1) phi
//     decay) that scales/persists the jitter accordingly.
//   • Jitter is a single scalar following x_{t+1} = phi * x_t +
//     gaussian(0, sigma). Bounded by phi<1, mean-reverts to 0.
//   • Output: basePrice * (1 + jitter). Pure multiplicative perturbation.
//
// Invariants:
//   • jitter has mean 0 → no long-term drift introduced
//   • applied AFTER EMA, NOT stored in state.smoothedPrice → macro
//     continuity preserved across ticks
//   • magnitude small enough that catastrophic clamp [seed*0.5, seed*2]
//     is never approached by jitter alone

export type MicroSubRegime =
  | 'CALM'
  | 'ACTIVE'
  | 'CONSOLIDATION'
  | 'BURST'
  | 'ABSORPTION'

interface MicroState {
  jitter:           number          // current AR(1) value
  subRegime:        MicroSubRegime
  subRegimeUntil:   number          // epoch ms when current sub-regime ends
}

// Markov transition weights. Rows sum to 1.0 (normalised inside picker).
// Pattern: BURST rarely → BURST (avoids spammy spikes); CONSOLIDATION often
// → ACTIVE (range → breakout pattern); ABSORPTION ofen → CALM (drains).
const TRANSITIONS: Record<MicroSubRegime, Record<MicroSubRegime, number>> = {
  CALM:          { CALM: 0.30, ACTIVE: 0.30, CONSOLIDATION: 0.20, BURST: 0.10, ABSORPTION: 0.10 },
  ACTIVE:        { CALM: 0.20, ACTIVE: 0.20, CONSOLIDATION: 0.20, BURST: 0.25, ABSORPTION: 0.15 },
  CONSOLIDATION: { CALM: 0.18, ACTIVE: 0.30, CONSOLIDATION: 0.15, BURST: 0.22, ABSORPTION: 0.15 },
  BURST:         { CALM: 0.25, ACTIVE: 0.30, CONSOLIDATION: 0.15, BURST: 0.05, ABSORPTION: 0.25 },
  ABSORPTION:    { CALM: 0.35, ACTIVE: 0.25, CONSOLIDATION: 0.15, BURST: 0.05, ABSORPTION: 0.20 },
}

// [min ms, max ms] per sub-regime. BURST is intentionally tight so it
// reads as a brief spike rather than a sustained tear.
const DURATION_RANGES: Record<MicroSubRegime, [number, number]> = {
  CALM:          [8_000, 30_000],
  ACTIVE:        [5_000, 18_000],
  CONSOLIDATION: [6_000, 20_000],
  BURST:         [800,    3_500],
  ABSORPTION:    [4_000, 12_000],
}

// Multiplier applied to per-tick effectiveVol to size the jitter shock.
// 2026-05-25 — multipliers bumped ~2.7× after the original numbers
// produced jitter that was too quiet against the macro trend: a strong
// TREND_DOWN_STRONG was creating 6+ consecutive bodies with virtually
// no wicks. New scale targets ~0.3% wick magnitude at 3-sigma during
// the BURST sub-regime — visible against typical 0.5-1% bodies.
// Math at phi=0.88: jitter equilibrium std = sigma / √(1 - phi²) =
// 2.1 × sigma, so per-tick shock std 2.7× larger → equilibrium ~3×
// larger → wicks ~3× more visible.
const VOL_MULT: Record<MicroSubRegime, number> = {
  CALM:          0.50,
  ACTIVE:        1.40,
  CONSOLIDATION: 0.28,
  BURST:         3.50,
  ABSORPTION:    0.80,
}

// AR(1) coefficient (decay rate). Higher = jitter lingers longer between
// ticks. BURST sticks around briefly for visible spike-then-decay; CON-
// SOLIDATION decays fast (= tight ranging).
const PHI: Record<MicroSubRegime, number> = {
  CALM:          0.82,
  ACTIVE:        0.88,
  CONSOLIDATION: 0.65,
  BURST:         0.85,
  ABSORPTION:    0.78,
}

// Per-asset state. Module-level Map keeps the engine's OtcAssetState
// untouched — adding fields there would force a snapshot schema change.
const microStates = new Map<string, MicroState>()

function pickNextSubRegime(current: MicroSubRegime, rand: () => number): MicroSubRegime {
  const row = TRANSITIONS[current]
  const total = Object.values(row).reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (const key of Object.keys(row) as MicroSubRegime[]) {
    r -= row[key]
    if (r <= 0) return key
  }
  return current
}

function pickDuration(regime: MicroSubRegime, rand: () => number): number {
  const [min, max] = DURATION_RANGES[regime]
  return min + rand() * (max - min)
}

function ensureState(assetId: string, now: number, rand: () => number): MicroState {
  let s = microStates.get(assetId)
  if (s) return s
  // Start in CALM so the first ticks after boot don't dump a BURST on
  // top of the bootGrace window the macro engine is using to suppress
  // its own spike branch.
  s = {
    jitter:         0,
    subRegime:      'CALM',
    subRegimeUntil: now + pickDuration('CALM', rand),
  }
  microStates.set(assetId, s)
  return s
}

/**
 * Per-tick micro perturbation. Call after EMA smoothing; the result is
 * the value to emit (tick.price + candle source). DO NOT store back into
 * state.smoothedPrice — the macro layer needs clean continuity.
 *
 * Pure function over (assetId state + baseVol + now + rand). Mutates the
 * per-asset MicroState only.
 */
export function applyMicroDynamics(
  assetId:   string,
  basePrice: number,
  baseVol:   number,
  now:       number,
  rand:      () => number = Math.random,
): number {
  const s = ensureState(assetId, now, rand)

  // Sub-regime transition when the current one expires.
  if (now >= s.subRegimeUntil) {
    s.subRegime      = pickNextSubRegime(s.subRegime, rand)
    s.subRegimeUntil = now + pickDuration(s.subRegime, rand)
  }

  // AR(1) jitter step.
  const sigma = VOL_MULT[s.subRegime] * baseVol
  const phi   = PHI[s.subRegime]
  s.jitter = phi * s.jitter + gaussian(0, sigma, rand)

  // Multiplicative perturbation — small enough that catastrophic clamp
  // protection on the macro price still bounds the emitted value safely.
  return basePrice * (1 + s.jitter)
}

/** Inspection helper for the admin status panel + tests. */
export function getMicroDebug(assetId: string): {
  subRegime:        MicroSubRegime
  subRegimeMsLeft:  number
  jitterBps:        number              // basis points (100 = 1%)
} | null {
  const s = microStates.get(assetId)
  if (!s) return null
  return {
    subRegime:       s.subRegime,
    subRegimeMsLeft: Math.max(0, s.subRegimeUntil - Date.now()),
    jitterBps:       Math.round(s.jitter * 10_000),
  }
}

/** Wipe state for one asset — used by the admin "reset" action. */
export function resetMicroState(assetId: string): void {
  microStates.delete(assetId)
}

/** Test-only escape hatch — clears every asset's micro state. */
export function _clearAllMicroStatesForTests(): void {
  microStates.clear()
}

// Box-Muller. Module-local copy so this file doesn't depend on pricing.ts.
function gaussian(mean: number, std: number, rand: () => number): number {
  const u = 1 - rand()
  const v = rand()
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
