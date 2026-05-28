// Platform settings — singleton row 'global' in platform_settings.
//
// Validation hot paths (deposit, withdrawal, operation creation) need
// these values per-request, so we keep them in a process-local cache.
// The admin PATCH handler calls `refreshSettingsCache()` after each
// write; everything else reads from the cache without touching the DB.

import { prisma } from '../prisma.js'

export interface PlatformSettings {
  withdrawalFeePct:        number
  withdrawalMin:           number
  withdrawalMax:           number
  depositMin:              number
  depositMax:              number
  depositRollover:         number
  operationMin:            number
  operationMax:            number
  operationMinIntervalMs:  number
  copyTradeEnabled:        boolean
  safeModeEnabled:         boolean
  updatedAt:               Date
}

// Defaults match the migration's INSERT — used only if the row is
// somehow missing (e.g. fresh DB before the seed ran).
const DEFAULTS: PlatformSettings = {
  withdrawalFeePct:       0,
  withdrawalMin:          60,
  withdrawalMax:          10_000,
  depositMin:             60,
  depositMax:             100_000,
  depositRollover:        2,
  operationMin:           5,
  operationMax:           100_000,
  operationMinIntervalMs: 1000,
  copyTradeEnabled:       true,
  safeModeEnabled:        false,
  updatedAt:              new Date(0),
}

let cache: PlatformSettings = DEFAULTS

/**
 * Load (or reload) the singleton row into the cache. Called once at
 * boot from main.ts and again from the admin PATCH handler.
 */
export async function refreshSettingsCache(): Promise<PlatformSettings> {
  try {
    const row = await prisma.platformSettings.findUnique({ where: { id: 'global' } })
    if (!row) return cache    // keep defaults; row should be seeded by migration
    cache = {
      withdrawalFeePct:       Number(row.withdrawalFeePct),
      withdrawalMin:          Number(row.withdrawalMin),
      withdrawalMax:          Number(row.withdrawalMax),
      depositMin:             Number(row.depositMin),
      depositMax:             Number(row.depositMax),
      depositRollover:        Number(row.depositRollover),
      operationMin:           Number(row.operationMin),
      operationMax:           Number(row.operationMax),
      operationMinIntervalMs: row.operationMinIntervalMs,
      copyTradeEnabled:       row.copyTradeEnabled,
      safeModeEnabled:        row.safeModeEnabled,
      updatedAt:              row.updatedAt,
    }
  } catch (err) {
    console.error('[settings] refresh failed — keeping previous cache', err)
  }
  return cache
}

/** Synchronous read of the current cached settings. Safe to call from
 *  any request handler. */
export function getSettings(): PlatformSettings {
  return cache
}

export interface UpdateSettingsInput {
  withdrawalFeePct?:       number
  withdrawalMin?:          number
  withdrawalMax?:          number
  depositMin?:             number
  depositMax?:             number
  depositRollover?:        number
  operationMin?:           number
  operationMax?:           number
  operationMinIntervalMs?: number
  copyTradeEnabled?:       boolean
  safeModeEnabled?:        boolean
}

export async function updateSettings(input: UpdateSettingsInput): Promise<PlatformSettings> {
  await prisma.platformSettings.upsert({
    where:  { id: 'global' },
    update: input,
    create: { id: 'global', ...input },
  })
  return refreshSettingsCache()
}
