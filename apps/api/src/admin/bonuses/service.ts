// Admin CRUD for promotional bonus codes (Fase B1).
// Endpoints wired in ./routes.ts under /admin/bonuses.

import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma.js'

export interface BonusListItem {
  id:             string
  code:           string
  type:           'PERCENTAGE' | 'FIXED'
  value:          string
  minDeposit:     string
  rollover:       number
  active:         boolean
  maxUsesPerUser: number
  expiresAt:      string | null
  // Stats for the admin list view — read in the same query as the row.
  activeGrants:   number
  totalGrants:    number
  createdAt:      string
  updatedAt:      string
}

export async function listAdminBonuses(): Promise<BonusListItem[]> {
  // Single SELECT + aggregate on grants. Subqueries keep this to one round-trip.
  const rows = await prisma.$queryRaw<Array<{
    id: string; code: string; type: 'PERCENTAGE' | 'FIXED';
    value: string; minDeposit: string; rollover: number;
    active: boolean; maxUsesPerUser: number;
    expiresAt: Date | null; createdAt: Date; updatedAt: Date;
    activeGrants: bigint; totalGrants: bigint;
  }>>`
    SELECT
      b.id, b.code, b.type::text AS type,
      b.value::text AS value,
      b."minDeposit"::text AS "minDeposit",
      b.rollover, b.active, b."maxUsesPerUser",
      b."expiresAt", b."createdAt", b."updatedAt",
      COALESCE(SUM(CASE WHEN g.status IN ('PENDING','ACTIVE') THEN 1 ELSE 0 END), 0)::bigint AS "activeGrants",
      COALESCE(COUNT(g.id), 0)::bigint AS "totalGrants"
    FROM bonuses b
    LEFT JOIN bonus_grants g ON g."bonusId" = b.id
    GROUP BY b.id
    ORDER BY b."createdAt" DESC
  `
  return rows.map(r => ({
    id:             r.id,
    code:           r.code,
    type:           r.type,
    value:          r.value,
    minDeposit:     r.minDeposit,
    rollover:       r.rollover,
    active:         r.active,
    maxUsesPerUser: r.maxUsesPerUser,
    expiresAt:      r.expiresAt?.toISOString() ?? null,
    activeGrants:   Number(r.activeGrants),
    totalGrants:    Number(r.totalGrants),
    createdAt:      r.createdAt.toISOString(),
    updatedAt:      r.updatedAt.toISOString(),
  }))
}

export interface CreateBonusInput {
  code:           string
  type:           'PERCENTAGE' | 'FIXED'
  value:          number
  minDeposit:     number
  rollover:       number
  active?:        boolean
  maxUsesPerUser?: number
  expiresAt?:     Date | null
}

export async function createBonus(input: CreateBonusInput) {
  return prisma.bonus.create({
    data: {
      code:           input.code.toUpperCase().trim(),
      type:           input.type,
      value:          new Prisma.Decimal(input.value),
      minDeposit:     new Prisma.Decimal(input.minDeposit),
      rollover:       input.rollover,
      active:         input.active ?? true,
      maxUsesPerUser: input.maxUsesPerUser ?? 1,
      expiresAt:      input.expiresAt ?? null,
    },
  })
}

export interface UpdateBonusInput {
  code?:           string
  type?:           'PERCENTAGE' | 'FIXED'
  value?:          number
  minDeposit?:     number
  rollover?:       number
  active?:         boolean
  maxUsesPerUser?: number
  expiresAt?:      Date | null
}

export async function updateBonus(id: string, input: UpdateBonusInput) {
  const data: Prisma.BonusUpdateInput = {}
  if (input.code           !== undefined) data.code           = input.code.toUpperCase().trim()
  if (input.type           !== undefined) data.type           = input.type
  if (input.value          !== undefined) data.value          = new Prisma.Decimal(input.value)
  if (input.minDeposit     !== undefined) data.minDeposit     = new Prisma.Decimal(input.minDeposit)
  if (input.rollover       !== undefined) data.rollover       = input.rollover
  if (input.active         !== undefined) data.active         = input.active
  if (input.maxUsesPerUser !== undefined) data.maxUsesPerUser = input.maxUsesPerUser
  if (input.expiresAt      !== undefined) data.expiresAt      = input.expiresAt
  return prisma.bonus.update({ where: { id }, data })
}

// Hard delete only if there are NO grants tied to it — otherwise foreign-key
// RESTRICT trips. Admin should toggle `active=false` to soft-disable.
export async function deleteBonus(id: string) {
  return prisma.bonus.delete({ where: { id } })
}
