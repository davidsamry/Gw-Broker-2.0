import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'
import {
  getAssetLiveState,
  listAssetLiveStates,
  reloadOtcV2Assets,
  resetAssetState,
  setAssetTrendBias,
  type OtcAssetLiveState,
} from '../../otc/v2/worker.js'

// Admin service for the OTC v2 engine. Joins the on-disk config rows
// (otc_assets) with two live data sources:
//   • the worker's in-memory state (price, regime, liquidity, pressure)
//   • the operations table (count + total stake of OPEN ops per asset)
//
// Every mutation writes an entry to otc_admin_logs. Raw SQL throughout —
// same pattern as the rest of /admin/*.

export interface OtcAdminAssetRow {
  id:               string
  symbol:           string
  name:             string
  category:         string
  enabled:          boolean
  paused:           boolean
  payout:           number
  seedPrice:        string        // serialised numeric
  volatilityBase:   number
  speedMultiplier:  number
  displayOrder:     number
  live:             OtcAssetLiveState | null
  openOpsCount:     number
  openOpsAmount:    string
}

export async function listAdminOtcAssets(): Promise<OtcAdminAssetRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; symbol: string; name: string; category: string;
    enabled: boolean; paused: boolean; payout: number;
    seedPrice: string; volatilityBase: number; speedMultiplier: number;
    displayOrder: number;
    openOpsCount: bigint; openOpsAmount: string | null;
  }>>`
    SELECT
      a.id, a.symbol, a.name,
      a.category::text                AS category,
      a.enabled, a.paused, a.payout,
      a."seedPrice"::text             AS "seedPrice",
      a."volatilityBase",
      a."speedMultiplier",
      a."displayOrder",
      COALESCE(o.cnt, 0)::bigint      AS "openOpsCount",
      COALESCE(o.total::text, '0')    AS "openOpsAmount"
    FROM otc_assets a
    LEFT JOIN (
      SELECT "assetId",
             COUNT(*)    AS cnt,
             SUM(amount) AS total
        FROM operations
       WHERE status = 'OPEN'
       GROUP BY "assetId"
    ) o ON o."assetId" = a.id
    ORDER BY a."displayOrder" ASC, a.symbol ASC
  `

  const liveMap = new Map(listAssetLiveStates().map(s => [s.id, s]))

  return rows.map(r => ({
    id:              r.id,
    symbol:          r.symbol,
    name:            r.name,
    category:        r.category,
    enabled:         r.enabled,
    paused:          r.paused,
    payout:          r.payout,
    seedPrice:       r.seedPrice,
    volatilityBase:  r.volatilityBase,
    speedMultiplier: r.speedMultiplier,
    displayOrder:    r.displayOrder,
    live:            liveMap.get(r.id) ?? null,
    openOpsCount:    Number(r.openOpsCount),
    openOpsAmount:   r.openOpsAmount ?? '0',
  }))
}

export async function getAdminOtcAsset(assetId: string): Promise<OtcAdminAssetRow | null> {
  const rows = await listAdminOtcAssets()
  return rows.find(a => a.id === assetId) ?? null
}

export interface UpdateOtcAssetInput {
  payout?:          number
  volatilityBase?:  number
  speedMultiplier?: number
  enabled?:         boolean
}

// Patch the on-disk config and call reloadOtcV2Assets so the change
// takes effect within ~one tick (the worker's loaded config object is
// overwritten in place). speedMultiplier specifically only fully kicks
// in on next process restart — the per-asset setInterval's period was
// captured in closure at boot. Documented in the admin UI.
export async function updateAdminOtcAsset(
  adminId: string,
  assetId: string,
  input:   UpdateOtcAssetInput,
): Promise<OtcAdminAssetRow | null> {
  const before = await getAdminOtcAsset(assetId)
  if (!before) return null

  await prisma.$executeRaw`
    UPDATE otc_assets
       SET payout           = COALESCE(${input.payout          ?? null}, payout),
           "volatilityBase" = COALESCE(${input.volatilityBase  ?? null}, "volatilityBase"),
           "speedMultiplier"= COALESCE(${input.speedMultiplier ?? null}, "speedMultiplier"),
           enabled          = COALESCE(${input.enabled         ?? null}, enabled),
           "updatedAt"      = NOW()
     WHERE id = ${assetId}
  `
  await reloadOtcV2Assets()
  const after = await getAdminOtcAsset(assetId)
  await writeAuditLog(adminId, 'UPDATE_ASSET', assetId, configSnapshot(before), configSnapshot(after))
  return after
}

export async function pauseAdminOtcAsset(adminId: string, assetId: string): Promise<OtcAdminAssetRow | null> {
  const before = await getAdminOtcAsset(assetId)
  if (!before) return null
  await prisma.$executeRaw`UPDATE otc_assets SET paused = true,  "updatedAt" = NOW() WHERE id = ${assetId}`
  await reloadOtcV2Assets()
  const after = await getAdminOtcAsset(assetId)
  await writeAuditLog(adminId, 'PAUSE_ASSET', assetId, { paused: before.paused }, { paused: after?.paused ?? null })
  return after
}

export async function resumeAdminOtcAsset(adminId: string, assetId: string): Promise<OtcAdminAssetRow | null> {
  const before = await getAdminOtcAsset(assetId)
  if (!before) return null
  await prisma.$executeRaw`UPDATE otc_assets SET paused = false, "updatedAt" = NOW() WHERE id = ${assetId}`
  await reloadOtcV2Assets()
  const after = await getAdminOtcAsset(assetId)
  await writeAuditLog(adminId, 'RESUME_ASSET', assetId, { paused: before.paused }, { paused: after?.paused ?? null })
  return after
}

// In-memory only — no DB row to update for the engine's runtime state.
// Logs the price/regime that existed before vs after for forensics.
export async function resetAdminOtcAsset(adminId: string, assetId: string): Promise<OtcAdminAssetRow | null> {
  const before = await getAdminOtcAsset(assetId)
  if (!before) return null
  const ok = resetAssetState(assetId)
  if (!ok) return null
  const after = await getAdminOtcAsset(assetId)
  await writeAuditLog(adminId, 'RESET_ASSET', assetId, before.live ?? null, after?.live ?? null)
  return after
}

export async function setAdminOtcAssetTrendBias(
  adminId: string,
  assetId: string,
  bias:    number,
): Promise<OtcAdminAssetRow | null> {
  const before = await getAdminOtcAsset(assetId)
  if (!before) return null
  const ok = setAssetTrendBias(assetId, bias)
  if (!ok) return null
  const after = await getAdminOtcAsset(assetId)
  await writeAuditLog(
    adminId,
    'SET_TREND_BIAS',
    assetId,
    { bias: before.live?.trendBias ?? 0 },
    { bias: after?.live?.trendBias ?? bias },
  )
  return after
}

// ── Logs ──────────────────────────────────────────────────────────────
export interface OtcAdminLogRow {
  id:           string
  adminId:      string
  adminEmail:   string | null
  action:       string
  assetId:      string | null
  beforeState:  unknown
  afterState:   unknown
  createdAt:    Date
}

export async function listAdminOtcLogs(
  assetId: string | undefined,
  limit:   number,
): Promise<OtcAdminLogRow[]> {
  const where: Prisma.Sql = assetId
    ? Prisma.sql`WHERE l."assetId" = ${assetId}`
    : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{
    id: bigint; adminId: string; adminEmail: string | null;
    action: string; assetId: string | null;
    beforeState: unknown; afterState: unknown; createdAt: Date;
  }>>`
    SELECT
      l.id, l."adminId", u.email AS "adminEmail",
      l.action, l."assetId",
      l."beforeState", l."afterState", l."createdAt"
    FROM otc_admin_logs l
    LEFT JOIN users u ON u.id = l."adminId"
    ${where}
    ORDER BY l."createdAt" DESC
    LIMIT ${limit}
  `
  return rows.map(r => ({
    id:          r.id.toString(),
    adminId:     r.adminId,
    adminEmail:  r.adminEmail,
    action:      r.action,
    assetId:     r.assetId,
    beforeState: r.beforeState,
    afterState:  r.afterState,
    createdAt:   r.createdAt,
  }))
}

// ── Internals ─────────────────────────────────────────────────────────
// What we put into otc_admin_logs.beforeState/afterState for UPDATE_ASSET.
// Stripped down to just the fields the admin could have changed, so diffs
// in the log table are easy to scan.
function configSnapshot(a: OtcAdminAssetRow | null): Record<string, unknown> | null {
  if (!a) return null
  return {
    payout:          a.payout,
    volatilityBase:  a.volatilityBase,
    speedMultiplier: a.speedMultiplier,
    enabled:         a.enabled,
  }
}

async function writeAuditLog(
  adminId: string,
  action:  string,
  assetId: string | null,
  before:  unknown,
  after:   unknown,
): Promise<void> {
  try {
    const beforeJson = JSON.stringify(before ?? null)
    const afterJson  = JSON.stringify(after  ?? null)
    await prisma.$executeRaw`
      INSERT INTO otc_admin_logs ("adminId", action, "assetId", "beforeState", "afterState", "createdAt")
      VALUES (${adminId}, ${action}, ${assetId}, ${beforeJson}::jsonb, ${afterJson}::jsonb, NOW())
    `
  } catch (err) {
    // Logging failure shouldn't break the admin action — surface to stderr.
    console.error('[otc-admin] audit log failed', err)
  }
}

// Re-export for the routes layer.
export { getAssetLiveState }
