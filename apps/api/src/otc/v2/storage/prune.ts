// Fase 7 — retention prune. Caps storage growth on otc_ticks +
// otc_candles + audit logs. All windows configurable via env, all
// DELETEs chunked + budgeted so they can't starve the connection pool.
//
// History of why this is careful:
//   • Fase 6.x first attempt did a single unbounded DELETE on
//     otc_ticks. With millions of accumulated rows, the row locks
//     held for tens of seconds and saturated the Prisma pool —
//     auth/login returned 500 INTERNAL_ERROR. Hotfix disabled the
//     prune entirely.
//   • This rewrite chunks via CTE+ctid (5k rows per round-trip) AND
//     enforces a 10s per-call budget AND requires the right indexes
//     to be in place (Fase 7 migrations add them).
//   • Re-enabled by default — toggle off with OTC_PRUNE_ENABLED=false
//     if anything goes sideways and you need the engine alive while
//     debugging.

import { prisma } from '../../../prisma.js'

// ── Configuration (env-overridable) ────────────────────────────────────
// Defaults are tuned to stay above the chart's CANDLES_PER_TF=3000
// cap per timeframe — users always have full scrollback history.
const TICKS_RETENTION_HOURS         = numEnv('OTC_TICKS_RETENTION_HOURS', 1)
const TF5_RETENTION_HOURS           = numEnv('OTC_CANDLES_TF5_RETENTION_HOURS', 6)
const TF15_RETENTION_DAYS           = numEnv('OTC_CANDLES_TF15_RETENTION_DAYS', 1)
const TF30_RETENTION_DAYS           = numEnv('OTC_CANDLES_TF30_RETENTION_DAYS', 2)
const TF60_RETENTION_DAYS           = numEnv('OTC_CANDLES_TF60_RETENTION_DAYS', 7)
const TF300_RETENTION_DAYS          = numEnv('OTC_CANDLES_TF300_RETENTION_DAYS', 30)
const AUDIT_LOG_RETENTION_DAYS      = numEnv('OTC_AUDIT_LOG_RETENTION_DAYS', 30)

export const PRUNE_ENABLED          = (process.env.OTC_PRUNE_ENABLED ?? 'true') !== 'false'

const PRUNE_CHUNK            = 5_000
const PRUNE_MAX_BUDGET_MS    = 10_000

function numEnv(name: string, def: number): number {
  const v = process.env[name]
  if (v == null || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

// CTE + ctid pattern — Postgres doesn't support DELETE ... LIMIT
// directly. ctid is the physical row pointer, fastest possible match.
// Each loop iteration is one round-trip; we yield to the event loop
// between iterations so the connection pool can serve other queries.
async function deleteChunked(
  table:      string,
  whereSql:   string,
  budgetMs:   number,
): Promise<number> {
  const start = Date.now()
  let totalDeleted = 0
  while (Date.now() - start < budgetMs) {
    const deleted: number = await prisma.$executeRawUnsafe(`
      WITH victim AS (
        SELECT ctid FROM ${table}
         WHERE ${whereSql}
         LIMIT ${PRUNE_CHUNK}
      )
      DELETE FROM ${table} t
       USING victim v
       WHERE t.ctid = v.ctid
    `)
    totalDeleted += deleted
    if (deleted < PRUNE_CHUNK) break  // drained
    // Yield so auth/login etc. can grab the pool between batches.
    await new Promise(r => setTimeout(r, 50))
  }
  return totalDeleted
}

// EXPLAIN expectations (verified with the indexes from Fase 7 migration
// 20260525040000 + the existing 20260525014500):
//
//   otc_ticks    WHERE recordedAt < NOW() - INTERVAL '1 hour'
//                → uses otc_ticks_recordedAt_idx (range scan)
//
//   otc_candles  WHERE timeframe = X AND openTime < Y
//                → uses otc_candles_timeframe_openTime_idx (range scan
//                  within the timeframe partition)
//
//   otc_admin_logs / otc_engine_logs WHERE createdAt < ...
//                → seq scan (table is tiny — < 10k rows ever)
//
// Each chunk delete is ~milliseconds with the indexes; cycle-time logged
// only when steady-state runs would normally stay silent.
export async function pruneOldData(): Promise<void> {
  try {
    const t = Date.now()

    const ticks = await deleteChunked(
      'otc_ticks',
      `"recordedAt" < NOW() - INTERVAL '${TICKS_RETENTION_HOURS} hours'`,
      PRUNE_MAX_BUDGET_MS,
    )

    // OR-chained per-timeframe retention. PG planner picks the
    // (timeframe, openTime) index for each branch.
    const candles = await deleteChunked(
      'otc_candles',
      `(timeframe = 5    AND "openTime" < NOW() - INTERVAL '${TF5_RETENTION_HOURS} hours') OR
       (timeframe = 15   AND "openTime" < NOW() - INTERVAL '${TF15_RETENTION_DAYS} days') OR
       (timeframe = 30   AND "openTime" < NOW() - INTERVAL '${TF30_RETENTION_DAYS} days') OR
       (timeframe = 60   AND "openTime" < NOW() - INTERVAL '${TF60_RETENTION_DAYS} days') OR
       (timeframe = 300  AND "openTime" < NOW() - INTERVAL '${TF300_RETENTION_DAYS} days')`,
      PRUNE_MAX_BUDGET_MS,
    )

    // Audit logs — small tables, single DELETE is fine.
    await prisma.$executeRawUnsafe(`
      DELETE FROM otc_admin_logs WHERE "createdAt" < NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days'
    `)
    await prisma.$executeRawUnsafe(`
      DELETE FROM otc_engine_logs WHERE "createdAt" < NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days'
    `)

    const ms = Date.now() - t
    if (ticks + candles > 0 || ms > 1000) {
      console.log(`[otc-v2] prune: ticks=${ticks} candles=${candles} in ${ms}ms`)
    }
  } catch (err) {
    console.error('[otc-v2] pruneOldData failed', err)
  }
}

// Logged once at boot — useful for verifying retention config.
export function logPruneConfig(): void {
  console.log(
    '[otc-v2] prune config:' +
    ` enabled=${PRUNE_ENABLED}` +
    ` ticks=${TICKS_RETENTION_HOURS}h` +
    ` tf5=${TF5_RETENTION_HOURS}h` +
    ` tf15=${TF15_RETENTION_DAYS}d` +
    ` tf30=${TF30_RETENTION_DAYS}d` +
    ` tf60=${TF60_RETENTION_DAYS}d` +
    ` tf300=${TF300_RETENTION_DAYS}d` +
    ` logs=${AUDIT_LOG_RETENTION_DAYS}d`,
  )
}
