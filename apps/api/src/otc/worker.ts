import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'

// Server-side OTC price worker. Replaces the per-browser random walk that
// today fabricates a different chart in every client. Single setInterval per
// process (singleton); writes one row per asset per tick into
// asset_price_ticks. Other code (chart candle endpoint, /otc/stream,
// operations resolver) reads from that table — same source for everyone.
//
// What's NOT here yet:
//   • Multi-instance leader-election (single API node today is fine).
//   • Retention pruning of old ticks (TODO before this is heavily loaded).
//   • Per-asset tick intervals (Asset.tickIntervalMs exists but ignored;
//     all assets tick on the same 1s clock for now).

const TICK_INTERVAL_MS = 1000

interface AssetState {
  seedPrice:  number   // baseline the walk reverts toward
  volatility: number   // tick size as fraction of seedPrice (e.g. 0.0005 = 5bp)
  price:      number   // current price (mutated in-place each tick)
}

// In-memory cache of "current price" per OTC asset. Avoids a SELECT per tick
// to keep the inner loop cheap; reseeded from DB on boot (so a process
// restart picks up where the previous one left off rather than jumping back
// to seedPrice).
const cache = new Map<string, AssetState>()

let intervalId: ReturnType<typeof setInterval> | null = null
let isTicking  = false

// One tick of the random walk. Three terms:
//   • shock     — uniform noise scaled by volatility
//   • reversion — slow pull back to seedPrice (keeps long-run mean stable)
//   • clamp     — never let price wander past 50%..200% of seed
// Drift is intentionally 0 here — the OTC product is supposed to be a
// fair coinflip in the long run; admin-controlled bias goes in via the
// `volatility` knob and (future) a `trend` column if we add one.
function step(prev: number, seed: number, vol: number): number {
  const shock     = (Math.random() - 0.5) * 2 * vol
  const reversion = ((seed - prev) / seed) * 0.0008
  const next      = prev * (1 + shock + reversion)
  if (next < seed * 0.5) return seed * 0.5
  if (next > seed * 2)   return seed * 2
  return next
}

// Decimal(18,5) — match the column. Most OTC prices fit; SHIB/PEPE-class
// micro-prices would round, but we don't have any in the OTC catalog today.
function round5(v: number): number {
  return Math.round(v * 100000) / 100000
}

// Load every OTC asset (no marketSymbol, seedPrice set, enabled). For each,
// resume from its last persisted tick if any — otherwise start at seedPrice.
async function bootstrap() {
  cache.clear()
  const rows = await prisma.$queryRaw<Array<{
    id: string; seedPrice: any; volatility: number; lastPrice: any | null
  }>>`
    SELECT
      a.id,
      a."seedPrice",
      a.volatility,
      (
        SELECT t.price
        FROM asset_price_ticks t
        WHERE t."assetId" = a.id
        ORDER BY t."recordedAt" DESC
        LIMIT 1
      ) AS "lastPrice"
    FROM assets a
    WHERE a."marketSymbol" IS NULL
      AND a."seedPrice" IS NOT NULL
      AND a.enabled = TRUE
  `
  for (const r of rows) {
    const seed = Number(r.seedPrice)
    const last = r.lastPrice != null ? Number(r.lastPrice) : seed
    cache.set(r.id, {
      seedPrice:  seed,
      volatility: r.volatility,
      price:      last,
    })
  }
  console.log(`[otc] bootstrapped ${cache.size} OTC asset(s)`)
}

// Compute next price for every cached asset then batch-INSERT all of them
// in one round-trip. With ~50 assets, this is one insert per second —
// trivial for Postgres.
async function tick() {
  if (isTicking || cache.size === 0) return
  isTicking = true
  try {
    const values: Prisma.Sql[] = []
    for (const [assetId, state] of cache) {
      state.price = round5(step(state.price, state.seedPrice, state.volatility))
      values.push(Prisma.sql`(${assetId}, ${state.price})`)
    }
    await prisma.$executeRaw`
      INSERT INTO asset_price_ticks ("assetId", price)
      VALUES ${Prisma.join(values, ', ')}
    `
  } catch (err) {
    console.error('[otc] tick failed', err)
  } finally {
    isTicking = false
  }
}

export function startOtcWorker(): void {
  if (intervalId) return
  void (async () => {
    await bootstrap()
    intervalId = setInterval(tick, TICK_INTERVAL_MS)
  })()
}

export function stopOtcWorker(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  cache.clear()
}

// Exposed for tests / future admin refresh — re-reads the asset list so a
// newly-enabled OTC asset or an updated seedPrice gets picked up without
// a process restart.
export async function reloadOtcAssets(): Promise<number> {
  await bootstrap()
  return cache.size
}
