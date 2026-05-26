import { randomUUID } from 'node:crypto'
import { prisma } from '../../prisma.js'

// Admin service for OTC manipulation signals + the master kill switch.
// Raw SQL throughout — same pattern as other admin services.

export type Direction = 'CALL' | 'PUT'

export interface ManipulationSignal {
  id:          string
  assetId:     string
  scheduledAt: Date
  timeframe:   number
  direction:   Direction
  enabled:     boolean
  createdAt:   Date
  updatedAt:   Date
}

export interface ManipulationSettings {
  enabled:   boolean
  updatedAt: Date
}

// ── Settings (master toggle) ──────────────────────────────────────────────

export async function getManipulationSettings(): Promise<ManipulationSettings> {
  const rows = await prisma.$queryRaw<Array<{ enabled: boolean; updatedAt: Date }>>`
    SELECT enabled, "updatedAt" FROM otc_manipulation_settings WHERE id = 'global' LIMIT 1
  `
  if (rows.length === 0) {
    // Defensive — migration seeds the row but a fresh DB clone might not.
    await prisma.$executeRaw`
      INSERT INTO otc_manipulation_settings (id, enabled) VALUES ('global', FALSE)
      ON CONFLICT DO NOTHING
    `
    return { enabled: false, updatedAt: new Date() }
  }
  return rows[0]
}

export async function setManipulationEnabled(enabled: boolean): Promise<ManipulationSettings> {
  await prisma.$executeRaw`
    UPDATE otc_manipulation_settings
    SET enabled = ${enabled}, "updatedAt" = NOW()
    WHERE id = 'global'
  `
  return getManipulationSettings()
}

// ── Signals CRUD ──────────────────────────────────────────────────────────

export async function listManipulationSignals(): Promise<ManipulationSignal[]> {
  return prisma.$queryRaw<ManipulationSignal[]>`
    SELECT id, "assetId", "scheduledAt", timeframe, direction, enabled, "createdAt", "updatedAt"
    FROM otc_manipulation_signals
    ORDER BY "scheduledAt" DESC
    LIMIT 500
  `
}

export interface CreateSignalInput {
  assetId:     string
  scheduledAt: Date
  timeframe:   number     // seconds (60 = M1)
  direction:   Direction
}

export async function createManipulationSignal(input: CreateSignalInput): Promise<ManipulationSignal> {
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO otc_manipulation_signals
      (id, "assetId", "scheduledAt", timeframe, direction, enabled, "createdAt", "updatedAt")
    VALUES
      (${id}, ${input.assetId}, ${input.scheduledAt}, ${input.timeframe},
       ${input.direction}, TRUE, NOW(), NOW())
  `
  const rows = await prisma.$queryRaw<ManipulationSignal[]>`
    SELECT id, "assetId", "scheduledAt", timeframe, direction, enabled, "createdAt", "updatedAt"
    FROM otc_manipulation_signals WHERE id = ${id} LIMIT 1
  `
  return rows[0]
}

export interface UpdateSignalInput {
  assetId?:     string
  scheduledAt?: Date
  timeframe?:   number
  direction?:   Direction
  enabled?:     boolean
}

export async function updateManipulationSignal(id: string, input: UpdateSignalInput): Promise<ManipulationSignal | null> {
  // Build dynamic SET — only update what was passed. Same pattern used by
  // the admin/users service.
  const sets: string[] = []
  const params: any[]  = []
  let i = 1
  if (input.assetId     !== undefined) { sets.push(`"assetId" = $${i++}`);     params.push(input.assetId) }
  if (input.scheduledAt !== undefined) { sets.push(`"scheduledAt" = $${i++}`); params.push(input.scheduledAt) }
  if (input.timeframe   !== undefined) { sets.push(`timeframe = $${i++}`);     params.push(input.timeframe) }
  if (input.direction   !== undefined) { sets.push(`direction = $${i++}`);     params.push(input.direction) }
  if (input.enabled     !== undefined) { sets.push(`enabled = $${i++}`);       params.push(input.enabled) }
  if (sets.length === 0) return getSignalById(id)

  sets.push(`"updatedAt" = NOW()`)
  const sql = `UPDATE otc_manipulation_signals SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`
  params.push(id)
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
  if (rows.length === 0) return null
  return getSignalById(id)
}

async function getSignalById(id: string): Promise<ManipulationSignal | null> {
  const rows = await prisma.$queryRaw<ManipulationSignal[]>`
    SELECT id, "assetId", "scheduledAt", timeframe, direction, enabled, "createdAt", "updatedAt"
    FROM otc_manipulation_signals WHERE id = ${id} LIMIT 1
  `
  return rows[0] ?? null
}

export async function deleteManipulationSignal(id: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM otc_manipulation_signals WHERE id = ${id} RETURNING id
  `
  return rows.length > 0
}
