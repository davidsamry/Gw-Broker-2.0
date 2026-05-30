// Slot-close alignment for binary-option expirations.
//
// Quotex / IQ Option / Olymp behaviour: when the user picks "1m", the op
// doesn't expire 60s after the click — it expires at the close of the
// next M1 candle. Same for M5 and M15. This guarantees the exit price
// is ALWAYS the candle's close, so vela vermelha = LOST and vela verde
// = WON without ambiguity (the user never sees "vela verde mas perdi"
// caused by a tick read mid-candle).
//
// Pure function — no I/O, no DB. Trivially testable.

/**
 * Minimum seconds between `now` and the chosen close. If the next slot
 * close is closer than this, the op skips to the slot AFTER (so a click
 * 3 seconds before the close doesn't yield a 3-second op).
 *
 * 10s is a balance: long enough for the user to see the marker on the
 * chart and react, short enough that the worst-case op is only ~10s
 * longer than the nominal timeframe (e.g. 1m turns into 60-70s, not
 * 60-120s).
 */
export const DEFAULT_MIN_TIME_MS = 10_000

/** Timeframes (in seconds) that the UI currently exposes. */
export const SUPPORTED_TIMEFRAMES_SEC = [60, 300, 900] as const
export type SupportedTimeframeSec = typeof SUPPORTED_TIMEFRAMES_SEC[number]

/**
 * Round `nowMs` UP to the next multiple of `timeframeMs`. If the next
 * multiple is closer than `minTimeMs`, return the one AFTER it.
 *
 * Examples (timeframe = 60s, minTimeMs = 10s):
 *   nowMs = T:05  → next M1 close at T+55s → 55s away, >= 10 → returned (op dura 55s)
 *   nowMs = T:30  → next M1 close at T+30s → 30s away, >= 10 → returned (op dura 30s)
 *   nowMs = T:55  → next M1 close at T+5s  → 5s away,  <  10 → skip → return T+65s (op dura 65s)
 *   nowMs = T:00  → next M1 close at T+60s → 60s away, >= 10 → returned (op dura 60s)
 *
 * For M5 (300s) and M15 (900s) the math is identical, just with the
 * larger period.
 */
export function alignExpirationToSlotClose(
  nowMs:        number,
  timeframeSec: SupportedTimeframeSec | number,
  minTimeMs:    number = DEFAULT_MIN_TIME_MS,
): Date {
  const timeframeMs   = timeframeSec * 1000
  const candidateMs   = Math.ceil(nowMs / timeframeMs) * timeframeMs
  // Edge: when nowMs falls EXACTLY on a slot boundary (rare — sub-ms
  // precision), Math.ceil returns nowMs itself. That'd be a 0-second
  // op, which is degenerate. The < minTimeMs check below catches this
  // (msUntil = 0 < 10000 → skip).
  const msUntilCandidate = candidateMs - nowMs
  const finalMs = msUntilCandidate < minTimeMs
    ? candidateMs + timeframeMs
    : candidateMs
  return new Date(finalMs)
}
