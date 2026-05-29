// Meta Pixel settings — single-row store + helper used by sender.
//
// Admin configures Pixel ID + Token + optional test-event code via the
// /admin/meta-pixel page. NO env vars touched — everything lives in the
// meta_pixel_settings table. Helper getMetaPixelSettings() is what
// service.ts reads on each send.

import { prisma } from '../prisma.js'

export interface MetaPixelSettings {
  enabled:       boolean
  pixelId:       string | null
  pixelToken:    string | null
  testEventCode: string | null
  updatedAt:     Date
}

// Mask helper — used in GET responses so the token never round-trips
// to the frontend in plaintext. "EAA…abcd" is enough for an admin to
// recognise which token is configured without exposing it.
export function maskToken(t: string | null | undefined): string {
  if (!t) return ''
  if (t.length < 8) return '****'
  return `${t.slice(0, 4)}...${t.slice(-4)}`
}

export async function getMetaPixelSettings(): Promise<MetaPixelSettings> {
  const rows = await prisma.$queryRaw<MetaPixelSettings[]>`
    SELECT enabled, "pixelId", "pixelToken", "testEventCode", "updatedAt"
    FROM meta_pixel_settings
    WHERE id = 'global'
    LIMIT 1
  `
  if (rows.length === 0) {
    // Defensive: row should exist from the migration seed, but if a
    // fresh DB clone skipped seeds, return safe defaults so the rest
    // of the system doesn't blow up.
    await prisma.$executeRaw`
      INSERT INTO meta_pixel_settings (id, enabled, "updatedAt")
      VALUES ('global', FALSE, NOW())
      ON CONFLICT (id) DO NOTHING
    `
    return { enabled: false, pixelId: null, pixelToken: null, testEventCode: null, updatedAt: new Date() }
  }
  return rows[0]
}

export interface UpdateMetaPixelInput {
  enabled?:       boolean
  pixelId?:       string | null
  pixelToken?:    string | null   // pass undefined to leave existing token untouched
  testEventCode?: string | null
}

/**
 * Patch update — only fields explicitly provided are touched. To clear
 * a field, pass `null`. To leave the token untouched (e.g. admin
 * editing other fields without re-typing the token), DON'T pass the
 * key at all (undefined).
 */
export async function updateMetaPixelSettings(input: UpdateMetaPixelInput): Promise<MetaPixelSettings> {
  // Build piece-by-piece so an unset key never overwrites. Same shape
  // as updateWebhookConfig — keeps each branch grepable.
  if (input.enabled !== undefined) {
    await prisma.$executeRaw`
      UPDATE meta_pixel_settings SET enabled = ${input.enabled}, "updatedAt" = NOW() WHERE id = 'global'
    `
  }
  if (input.pixelId !== undefined) {
    await prisma.$executeRaw`
      UPDATE meta_pixel_settings SET "pixelId" = ${input.pixelId}, "updatedAt" = NOW() WHERE id = 'global'
    `
  }
  if (input.pixelToken !== undefined) {
    await prisma.$executeRaw`
      UPDATE meta_pixel_settings SET "pixelToken" = ${input.pixelToken}, "updatedAt" = NOW() WHERE id = 'global'
    `
  }
  if (input.testEventCode !== undefined) {
    await prisma.$executeRaw`
      UPDATE meta_pixel_settings SET "testEventCode" = ${input.testEventCode}, "updatedAt" = NOW() WHERE id = 'global'
    `
  }
  return getMetaPixelSettings()
}
