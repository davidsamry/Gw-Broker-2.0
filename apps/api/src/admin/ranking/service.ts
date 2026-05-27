// Admin CRUD on the ranking pool. The public /ranking endpoint draws
// from these rows every 3h. Admin sees the FULL list (not the rotation
// slice) so they can curate the whole pool.

import { prisma } from '../../prisma.js'

export interface AdminRankingEntry {
  id:          string
  name:        string
  countryCode: string
  amount:      number
  active:      boolean
  updatedAt:   string
  createdAt:   string
}

function toRow(e: {
  id: string; name: string; countryCode: string;
  amount: { toString: () => string }; active: boolean;
  updatedAt: Date; createdAt: Date;
}): AdminRankingEntry {
  return {
    id: e.id, name: e.name, countryCode: e.countryCode,
    amount: Number(e.amount.toString()), active: e.active,
    updatedAt: e.updatedAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
  }
}

export async function listAdminRanking(): Promise<AdminRankingEntry[]> {
  const rows = await prisma.rankingEntry.findMany({
    orderBy: [{ active: 'desc' }, { amount: 'desc' }],
  })
  return rows.map(toRow)
}

export interface CreateRankingInput {
  name:        string
  countryCode: string
  amount:      number
  active?:     boolean
}

export async function createRankingEntry(input: CreateRankingInput): Promise<AdminRankingEntry> {
  const created = await prisma.rankingEntry.create({
    data: {
      name:        input.name.trim(),
      countryCode: input.countryCode.toLowerCase().trim(),
      amount:      input.amount,
      active:      input.active ?? true,
    },
  })
  return toRow(created)
}

export interface UpdateRankingInput {
  name?:        string
  countryCode?: string
  amount?:      number
  active?:      boolean
}

export async function updateRankingEntry(id: string, input: UpdateRankingInput): Promise<AdminRankingEntry | null> {
  try {
    const updated = await prisma.rankingEntry.update({
      where: { id },
      data: {
        ...(input.name        !== undefined && { name:        input.name.trim() }),
        ...(input.countryCode !== undefined && { countryCode: input.countryCode.toLowerCase().trim() }),
        ...(input.amount      !== undefined && { amount:      input.amount }),
        ...(input.active      !== undefined && { active:      input.active }),
      },
    })
    return toRow(updated)
  } catch {
    return null
  }
}

export async function deleteRankingEntry(id: string): Promise<boolean> {
  try {
    await prisma.rankingEntry.delete({ where: { id } })
    return true
  } catch {
    return false
  }
}
