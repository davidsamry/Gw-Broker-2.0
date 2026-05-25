// Fase 4 — otc_ticks I/O. Latest-per-asset (boot recovery, Fase 2)
// + batched flush (10Hz ticks → INSERT every 1s).

import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma.js'
import type { OtcTick } from '../types.js'

// What loadLatestTicks returns per asset (Fase 2 recovery source).
export interface LatestTickInfo {
  price:      number
  recordedAt: Date
}

// One round-trip to fetch the latest tick per asset, using DISTINCT
// ON (Postgres) + the (assetId, recordedAt DESC) index. Returns null
// per asset when otc_ticks has no row for it (fresh asset or post-
// prune state where ticks were cleaned past the retention).
export async function loadLatestTicks(assetIds: string[]): Promise<Map<string, LatestTickInfo | null>> {
  const out = new Map<string, LatestTickInfo | null>()
  for (const id of assetIds) out.set(id, null)
  if (assetIds.length === 0) return out
  try {
    const rows = await prisma.$queryRaw<Array<{
      assetId: string; price: string; recordedAt: Date;
    }>>`
      SELECT DISTINCT ON ("assetId") "assetId", price::text, "recordedAt"
      FROM otc_ticks
      WHERE "assetId" = ANY(${assetIds}::text[])
      ORDER BY "assetId", "recordedAt" DESC
    `
    for (const r of rows) {
      out.set(r.assetId, { price: Number(r.price), recordedAt: r.recordedAt })
    }
  } catch (err) {
    console.error('[otc-v2] loadLatestTicks failed — tick fallback disabled', err)
  }
  return out
}

// Batched INSERT — called by the runtime's 1s flush loop with the
// snapshot of pendingTicks. No ON CONFLICT — ticks are append-only
// (no PK collisions possible with autoincrement id).
export async function flushTicksBatch(ticks: OtcTick[]): Promise<void> {
  if (ticks.length === 0) return
  const values = ticks.map(t => Prisma.sql`(${t.assetId}, ${t.price}, ${t.recordedAt})`)
  await prisma.$executeRaw`
    INSERT INTO otc_ticks ("assetId", price, "recordedAt")
    VALUES ${Prisma.join(values, ', ')}
  `
}
