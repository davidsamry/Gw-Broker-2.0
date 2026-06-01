// Lembrar dispositivo do admin — pula o codigo 2FA em dispositivos
// previamente confiados. Token randomico (32 bytes hex) salvo em hash
// no DB + cookie httpOnly samesite=strict no client.

import crypto from 'node:crypto'
import { prisma } from '../prisma.js'

export const TRUST_COOKIE_NAME = 'vx_admin_trust'
const TTL_DAYS = 30
export const TRUST_COOKIE_MAX_AGE_SEC = TTL_DAYS * 24 * 60 * 60
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Cria um trusted device pro user. Retorna o token RAW (deve ser
 * enviado pro client via cookie; nunca persistido fora do DB).
 */
export async function createTrustedDevice(args: {
  userId:     string
  userAgent?: string | null
  ip?:        string | null
}): Promise<string> {
  const tokenRaw  = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(tokenRaw)
  await prisma.adminTrustedDevice.create({
    data: {
      userId:    args.userId,
      tokenHash,
      userAgent: args.userAgent ?? null,
      ip:        args.ip ?? null,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  })
  return tokenRaw
}

/**
 * Valida o token do cookie contra o DB. Bate userId, expiresAt e
 * revokedAt. Se valido, bumpa lastUsedAt e retorna true.
 */
export async function verifyTrustedDevice(args: {
  userId:   string
  tokenRaw: string
}): Promise<boolean> {
  if (!args.tokenRaw || args.tokenRaw.length < 32) return false
  const tokenHash = hashToken(args.tokenRaw)
  const device    = await prisma.adminTrustedDevice.findUnique({ where: { tokenHash } })
  if (!device) return false
  if (device.userId !== args.userId) return false
  if (device.revokedAt) return false
  const now = new Date()
  if (device.expiresAt < now) return false
  // Bumpa lastUsedAt — util pra UI de "dispositivos conectados"
  await prisma.adminTrustedDevice.update({
    where: { id: device.id },
    data:  { lastUsedAt: now },
  })
  return true
}

/**
 * Revoga UM trusted device especifico (lookup pelo hash do token).
 * Usado pelo "Esquecer este dispositivo" UI.
 */
export async function revokeTrustedDevice(tokenRaw: string): Promise<void> {
  if (!tokenRaw) return
  const tokenHash = hashToken(tokenRaw)
  await prisma.adminTrustedDevice.updateMany({
    where: { tokenHash, revokedAt: null },
    data:  { revokedAt: new Date() },
  })
}
