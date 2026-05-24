import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'

// Admin assets management — raw SQL like the other admin services.

export type AssetCategory = 'OPEN_MARKET' | 'OTC' | 'CRYPTO'

export interface AssetRow {
  id:           string
  symbol:       string
  name:         string
  category:     AssetCategory
  payout:       number
  enabled:      boolean
  code1:        string | null
  code2:        string | null
  marketSymbol: string | null
  displayOrder: number
  createdAt:    Date
  updatedAt:    Date
}

export interface ListAssetsParams {
  category?: 'ALL' | AssetCategory
}

export interface AssetCounts {
  total:      number
  openMarket: number
  otc:        number
  crypto:     number
}

export interface ListAssetsResponse {
  assets: AssetRow[]
  counts: AssetCounts
}

export async function listAdminAssets(params: ListAssetsParams): Promise<ListAssetsResponse> {
  const where: Prisma.Sql = params.category && params.category !== 'ALL'
    ? Prisma.sql`WHERE category = ${params.category}::"AssetCategory"`
    : Prisma.empty

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<AssetRow[]>`
      SELECT
        id, symbol, name,
        category::text AS category,
        payout, enabled,
        code1, code2, "marketSymbol",
        "displayOrder", "createdAt", "updatedAt"
      FROM assets
      ${where}
      ORDER BY "displayOrder" ASC, symbol ASC
    `,
    prisma.$queryRaw<Array<{
      total: bigint; openMarket: bigint; otc: bigint; crypto: bigint
    }>>`
      SELECT
        COUNT(*)::bigint                                                       AS total,
        COUNT(*) FILTER (WHERE category = 'OPEN_MARKET'::"AssetCategory")::bigint AS "openMarket",
        COUNT(*) FILTER (WHERE category = 'OTC'::"AssetCategory")::bigint      AS otc,
        COUNT(*) FILTER (WHERE category = 'CRYPTO'::"AssetCategory")::bigint   AS crypto
      FROM assets
    `,
  ])

  const c = counts[0]
  return {
    assets: rows,
    counts: {
      total:      Number(c?.total      ?? 0),
      openMarket: Number(c?.openMarket ?? 0),
      otc:        Number(c?.otc        ?? 0),
      crypto:     Number(c?.crypto     ?? 0),
    },
  }
}

export interface UpdateAssetInput {
  name?:    string
  payout?:  number
  enabled?: boolean
}

// Per-row update. Only the fields present in the payload are touched —
// missing keys are left alone (COALESCE pattern). Returns the updated row.
export async function updateAsset(id: string, input: UpdateAssetInput): Promise<AssetRow | null> {
  const rows = await prisma.$queryRaw<AssetRow[]>`
    UPDATE assets
    SET
      name      = COALESCE(${input.name ?? null}, name),
      payout    = COALESCE(${input.payout ?? null}, payout),
      enabled   = COALESCE(${input.enabled ?? null}, enabled),
      "updatedAt" = NOW()
    WHERE id = ${id}
    RETURNING
      id, symbol, name,
      category::text AS category,
      payout, enabled,
      code1, code2, "marketSymbol",
      "displayOrder", "createdAt", "updatedAt"
  `
  return rows[0] ?? null
}

// Bulk set payout — either for everyone or for a specific category. Used by
// the "Aplicar a todos" header control.
export async function bulkSetPayout(payout: number, category?: AssetCategory): Promise<number> {
  const where: Prisma.Sql = category
    ? Prisma.sql`WHERE category = ${category}::"AssetCategory"`
    : Prisma.empty
  return prisma.$executeRaw`
    UPDATE assets
    SET payout = ${payout}, "updatedAt" = NOW()
    ${where}
  `
}
