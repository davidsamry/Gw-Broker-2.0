import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

// ── Connection pool sizing ─────────────────────────────────────────────
// Prisma's default `connection_limit` is `num_physical_cpus × 2 + 1`,
// which on a small EasyPanel container (1 vCPU) ends up at just 3.
// Three connections is nowhere near enough for this workload:
//
//   • OTC v2 engine: 1s tick flush + 5s state flush + 5s snapshot flush
//     + 30s gap sweep + 5min prune (each takes a connection while
//     active)
//   • Operations worker: 1s pending-op poll
//   • Auth: every /auth/login and /auth/me hits the DB
//   • Admin endpoints + user APIs
//
// On 2026-05-25 prod logs showed:
//     `[otc-v2] tick flush failed PrismaClientKnownRequestError:
//      Timed out fetching a new connection from the connection pool.
//      Current connection pool timeout: 10, connection limit: 3`
// — meaning tick flushes were queuing behind login/me/snapshot etc.
// and dying at the 10s timeout. Login itself was taking 12s e2e.
//
// We append `connection_limit` + `pool_timeout` to DATABASE_URL only
// if the user hasn't already set them, so an operator can still
// override via the env var without editing code. 20 connections is
// generous for this workload but well under Supabase Supavisor's
// session-mode cap (which mirrors the underlying Postgres
// `max_connections`, typically 60+ on the free tier and 200+ on paid).
function buildDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    // Let Prisma throw its own clear error downstream.
    return ''
  }
  try {
    const url = new URL(raw)
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '20')
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '20')
    }
    return url.toString()
  } catch {
    // Malformed URL — return raw and let Prisma report it.
    return raw
  }
}

const databaseUrl = buildDatabaseUrl()

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
    datasources: databaseUrl
      ? { db: { url: databaseUrl } }
      : undefined,
  })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}
