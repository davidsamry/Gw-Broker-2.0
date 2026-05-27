// In-memory rate limiter for the Bot API.
//
// Scope: per-IP login attempts. The spec says 5 logins / 5min / IP, and
// a successful login resets the counter.
//
// Why in-memory: API runs as a single Fastify instance — a Redis-backed
// limiter is overkill until we horizontally scale. Trade-off: counts
// reset on API restart (briefly more permissive after a deploy).
//
// Garbage collection: a setInterval prunes stale entries every minute so
// the Map doesn't grow unbounded under sustained traffic.

interface Bucket {
  count:     number
  resetAt:   number   // epoch ms when the window resets
}

const WINDOW_MS    = 5 * 60 * 1000  // 5 minutes
const MAX_ATTEMPTS = 5
const buckets = new Map<string, Bucket>()

// GC every 60s — drops buckets whose window already expired. Cheap, the
// Map rarely grows past a few hundred entries.
setInterval(() => {
  const now = Date.now()
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key)
  }
}, 60_000).unref()

export interface RateLimitResult {
  allowed:     boolean
  remaining:   number
  retryAfterS: number   // seconds until window resets (0 when allowed)
}

/** Check (without consuming) whether the next request would be allowed.
 *  Used by /login BEFORE running bcrypt so an attacker can't slow the
 *  server with throwaway passwords. */
export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    return { allowed: true, remaining: MAX_ATTEMPTS, retryAfterS: 0 }
  }
  return {
    allowed:     b.count < MAX_ATTEMPTS,
    remaining:   Math.max(0, MAX_ATTEMPTS - b.count),
    retryAfterS: Math.ceil((b.resetAt - now) / 1000),
  }
}

/** Increment the counter. Call AFTER a failed login attempt. */
export function recordFailure(key: string): void {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  b.count += 1
}

/** Reset the bucket on a successful login (matches the spec). */
export function resetLimit(key: string): void {
  buckets.delete(key)
}
