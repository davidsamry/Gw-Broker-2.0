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

  // Mulberry32 — small, fast, well-distributed PRNG. Seeded with the
  // window index so every node in the cluster computes the same draw.
  const rand = mulberry32(windowIndex >>> 0)

  // Fisher–Yates shuffle on a copy.
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Take top N (or whatever's available if pool < N), assign ranks 1..N.
  const slice = shuffled.slice(0, LEADERBOARD_SIZE)
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
