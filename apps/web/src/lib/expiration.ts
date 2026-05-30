// Mirror of apps/api/src/operations/expiration.ts — the SAME math the
// backend uses when deciding when an op closes. Lives in the frontend
// so the optimistic marker can show the CORRECT countdown immediately,
// instead of showing "01:00" for 1-3s and then jumping to the real
// (often shorter) value once the POST response arrives.
//
// Both sides feed Date.now() into the same function within ~milliseconds
// of each other, so the local computation matches what the server will
// pick. If they ever drift by a slot boundary (rare — clock skew, GC
// pause), the post-POST replacesId emit still corrects the marker.
//
// MUST stay in lockstep with the backend file. Any change here without
// the backend change (or vice versa) reintroduces the same visual jump
// this file exists to prevent.

export const DEFAULT_MIN_TIME_MS = 10_000

export const SUPPORTED_TIMEFRAMES_SEC = [60, 300, 900] as const
export type SupportedTimeframeSec = typeof SUPPORTED_TIMEFRAMES_SEC[number]

export function alignExpirationToSlotClose(
  nowMs:        number,
  timeframeSec: SupportedTimeframeSec | number,
  minTimeMs:    number = DEFAULT_MIN_TIME_MS,
): Date {
  const timeframeMs   = timeframeSec * 1000
  const candidateMs   = Math.ceil(nowMs / timeframeMs) * timeframeMs
  const msUntilCandidate = candidateMs - nowMs
  const finalMs = msUntilCandidate < minTimeMs
    ? candidateMs + timeframeMs
    : candidateMs
  return new Date(finalMs)
}
