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
// Amount range used to generate per-window fictional earnings. The
// admin-supplied `amount` in the DB is IGNORED for the public view —
// see the comment inside getPublicRanking. Tweak these constants if
// the platform's bet sizes change and the leaderboard starts looking
// implausible.
const AMOUNT_MIN = 5_000
const AMOUNT_MAX = 40_000

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

  // Three-stage selection (window-deterministic, same for everyone for 3h):
  //   1. Shuffle the pool with a window-seeded PRNG → picks WHICH 25
  //      entries appear (rotates every 3h).
  //   2. Generate a fresh amount per slot from the SAME PRNG. The
  //      admin-supplied amount in `ranking_entries.amount` is INTENTIONALLY
  //      IGNORED here — earlier we used it directly, which meant the
  //      top names with the largest DB amounts were locked at ranks 1-3
  //      every rotation (Yonathan/Joseph/Felipe never moved). Generating
  //      amounts in [AMOUNT_MIN, AMOUNT_MAX] per window means even if
  //      the same 25 names repeat (small pool), the order changes
  //      drastically — different rotation, different ranks.
  //   3. Sort the chosen 25 by generated amount DESC → "líderes" still
  //      means "leaders by money".
  const rand = mulberry32(windowIndex >>> 0)
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const slice = shuffled.slice(0, LEADERBOARD_SIZE)

  // Generate amounts AFTER the slice so the PRNG state is consumed
  // consistently regardless of pool size (otherwise adding entries to
  // the admin pool would silently change every existing rank). Each
  // slot pulls one rand() — fully determined by windowIndex.
  const withAmounts = slice.map((e) => ({
    name:        e.name,
    countryCode: e.countryCode,
    amount:      AMOUNT_MIN + rand() * (AMOUNT_MAX - AMOUNT_MIN),
  }))
  withAmounts.sort((a, b) => b.amount - a.amount)

  const entries: PublicRankingEntry[] = withAmounts.map((e, i) => ({
    rank:   i + 1,
    name:   e.name,
    code:   e.countryCode,
    // 2-decimal currency precision — round once here so the wire payload
    // matches what the frontend renders (no Math.floor in the panel).
    amount: Math.round(e.amount * 100) / 100,
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
  // 2026-06-01: admin e isFake nao aparecem no ranking publico. Admin e'
  // staff (nao compete com users reais) e isFake forca WIN sempre (apareceria
  // sempre no topo, quebra o realismo). Retorna direto antes de processar.
  const userMeta = await prisma.user.findUnique({
    where:  { id: userId },
    select: { role: true, isFake: true },
  })
  if (!userMeta || userMeta.role === 'ADMIN' || userMeta.isFake) {
    return { amount: 0, position: null }
  }

  // Week starts on Monday 00:00 in BRT (UTC-3). Mirrors the "Líderes da
  // semana" wording in the panel header.
  const now = new Date()
  const day = now.getUTCDay()                  // 0=Sunday … 6=Saturday
  const daysSinceMonday = (day + 6) % 7        // Mon=0, Sun=6
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday, 3, 0, 0, 0)) // 00:00 BRT == 03:00 UTC

  // The OperationStatus enum is OPEN / WON / LOST / CANCELLED — there's
  // NO 'RESOLVED' value, and there's NO `won` column on the operations
  // table. The old query filtered on both, hit a SQL error, was swallowed
  // by the route's try/catch and silently returned `amount: 0` — so
  // every user (real OR fake) saw "Você ainda não teve nenhuma negociação
  // lucrativa". Status='WON' alone is the win signal; profit on WON rows
  // is always > 0 by construction.
  const rows = await prisma.$queryRaw<Array<{ total: string | null }>>`
    SELECT COALESCE(SUM(o.profit), 0)::text AS total
    FROM operations o
    JOIN accounts   a ON a.id = o."accountId"
    WHERE a."userId"  = ${userId}
      AND a.type      = 'REAL'::"AccountType"
      AND o.status    = 'WON'::"OperationStatus"
      AND o."openedAt" >= ${monday}
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
