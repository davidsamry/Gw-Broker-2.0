// Ranking service — picks the 25 entries shown on the public leaderboard.
//
// Rotation contract: every 3 hours the SAME 25 entries appear, in the
// same order, for every visitor — so the displayed leaderboard feels
// stable rather than reshuffling on each page load. At the boundary of
// the next 3h window, a new draw is computed.
//
// Implementation: derive a deterministic seed from `floor(now / 3h)`,
// use it to shuffle the pool, take the first N. Same window → same seed
// → same output. No DB writes; pure compute + a single SELECT.

import { prisma } from '../prisma.js'

export interface PublicRankingEntry {
  rank:   number       // 1..N
  name:   string
  // Named `code` (not `countryCode`) to match the frontend RankingPanel's
  // LeaderEntry interface — keeps the wire payload smaller and avoids a
  // mapping layer on the frontend.
  code:   string       // ISO 3166-1 alpha-2 (lowercase)
  amount: number       // BRL
}

export interface PublicRankingResponse {
  entries:        PublicRankingEntry[]
  rotatesAt:      string    // ISO of the next 3h boundary (UI shows countdown)
  windowStartedAt:string    // ISO of when this rotation began
}

const ROTATION_MS = 3 * 60 * 60 * 1000   // 3 hours
const LEADERBOARD_SIZE = 25

export async function getPublicRanking(): Promise<PublicRankingResponse> {
  const now             = Date.now()
  const windowIndex     = Math.floor(now / ROTATION_MS)
  const windowStartedAt = new Date(windowIndex * ROTATION_MS)
  const rotatesAt       = new Date((windowIndex + 1) * ROTATION_MS)

  // Pull the active pool. We slightly over-fetch — even when there are
  // exactly 25 entries we want a stable order before the shuffle, hence
  // ORDER BY id so two pulls produce the same starting array.
  const pool = await prisma.rankingEntry.findMany({
    where:   { active: true },
    orderBy: { id: 'asc' },
    select:  { name: true, countryCode: true, amount: true },
  })

  if (pool.length === 0) {
    return { entries: [], rotatesAt: rotatesAt.toISOString(), windowStartedAt: windowStartedAt.toISOString() }
  }

  // Two-stage selection:
  //   1. Shuffle the pool with a window-seeded PRNG → picks WHICH 25
  //      entries appear (rotates every 3h).
  //   2. Sort the chosen 25 by amount DESC → ranks 1..25 are honest
  //      ("Líderes" = leaders, so the largest amount must be #1).
  //
  // Earlier versions skipped step 2 and the leaderboard showed entries
  // out of monetary order — the admin pool had IA Axecash at R$ 41k as
  // the top, but the visible list put Bruno C. at R$ 35k in position 1.
  const rand = mulberry32(windowIndex >>> 0)
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const slice = shuffled
    .slice(0, LEADERBOARD_SIZE)
    .sort((a, b) => Number(b.amount) - Number(a.amount))

  const entries: PublicRankingEntry[] = slice.map((e, i) => ({
    rank:   i + 1,
    name:   e.name,
    code:   e.countryCode,
    amount: Number(e.amount),
  }))

  return {
    entries,
    rotatesAt:       rotatesAt.toISOString(),
    windowStartedAt: windowStartedAt.toISOString(),
  }
}

// ── Per-user weekly stats ────────────────────────────────────────────────
// Sums up the logged-in user's winnings (profit on RESOLVED+won operations)
// in the current week, then determines their relative position against the
// active leaderboard slice. Position is `null` when the user has 0 weekly
// profit OR can't crack the top of the fake pool — UI shows "—" then.
export interface MeRanking {
  amount:   number          // user's weekly winnings, R$
  position: number | null   // 1..25 if they'd land in the leaderboard, else null
}

export async function getMyWeeklyRanking(userId: string): Promise<MeRanking> {
  // Week starts on Monday 00:00 in BRT (UTC-3). Mirrors the "Líderes da
  // semana" wording in the panel header.
  const now = new Date()
  const day = now.getUTCDay()                  // 0=Sunday … 6=Saturday
  const daysSinceMonday = (day + 6) % 7        // Mon=0, Sun=6
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday, 3, 0, 0, 0)) // 00:00 BRT == 03:00 UTC

  const rows = await prisma.$queryRaw<Array<{ total: string | null }>>`
    SELECT COALESCE(SUM(o.profit), 0)::text AS total
    FROM operations o
    JOIN accounts   a ON a.id = o."accountId"
    WHERE a."userId" = ${userId}
      AND a.type    = 'REAL'::"AccountType"
      AND o.status  = 'RESOLVED'::"OperationStatus"
      AND o.won     = true
      AND o."createdAt" >= ${monday}
  `
  const amount = Number(rows[0]?.total ?? 0)

  if (amount <= 0) return { amount: 0, position: null }

  // Compare to the leaderboard's current 25 entries — if user is above
  // any of them, slot in accordingly. We re-derive the same draw so the
  // ranking is self-consistent.
  const board = await getPublicRanking()
  if (board.entries.length === 0) return { amount, position: 1 }

  // First entry whose amount is < user's amount → user's position is that
  // entry's rank.
  for (const entry of board.entries) {
    if (amount > entry.amount) return { amount, position: entry.rank }
  }
  return { amount, position: null }  // below the bottom of the visible list
}

function mulberry32(seed: number): () => number {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
