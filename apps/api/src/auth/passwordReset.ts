// Password-reset flow — request + confirm.
//
// Threat model:
//   • The reset link is sent to the email on file. Anyone with access to
//     that inbox can hijack the account — that's true of every reset
//     flow and acceptable.
//   • The token is a 32-byte random string sent in the email URL; only
//     its sha256 hash is stored. A DB dump can't be replayed.
//   • Tokens expire 1h after creation and burn on first use.
//   • Email enumeration: the request endpoint ALWAYS returns 200, so an
//     attacker can't tell whether an email is registered. (Cost: a real
//     user with a typo won't get the email and won't know why — they'll
//     retry, see no error, and likely realize their mistake.)

import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../prisma.js'
import { sendEmail } from '../email/service.js'

const TOKEN_TTL_MS = 60 * 60 * 1000   // 1h
const RESET_BASE_URL = process.env.FRONTEND_URL ?? 'https://vx-global.com'

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

/**
 * User asks to reset their password by providing an email. We ALWAYS
 * return success (even if no user with that email exists) to avoid
 * giving attackers a "user exists" oracle. If a real user matches, we
 * issue a single-use token and email them the link.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalised = email.toLowerCase().trim()
  const user = await prisma.user.findUnique({ where: { email: normalised } })
  if (!user) return    // silent — see threat-model note above

  // Burn any older non-expired, non-used tokens for this user so they
  // can't pile up. Cheap because the userId index makes the lookup fast.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data:  { usedAt: new Date() },
  })

  const rawToken = randomBytes(32).toString('hex')   // 64-char hex
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  })

  const resetLink = `${RESET_BASE_URL}/reset-password?token=${rawToken}`
  await sendEmail({
    templateKey: 'PASSWORD_RESET',
    to:          user.email,
    vars:        { name: user.name, reset_link: resetLink },
  })
}

/**
 * Validate a reset token + set the new password. Returns the user so
 * the caller can issue a fresh JWT (auto-login post reset, optional).
 *
 * Errors thrown:
 *   • TOKEN_INVALID      — token doesn't exist
 *   • TOKEN_EXPIRED      — past expiresAt
 *   • TOKEN_USED         — already burned
 *   • PASSWORD_TOO_SHORT — under 8 chars
 */
export async function resetPasswordWithToken(rawToken: string, newPassword: string): Promise<{
  id: string; email: string
}> {
  if (newPassword.length < 8) throw new Error('PASSWORD_TOO_SHORT')

  const tokenHash = hashToken(rawToken)
  const record = await prisma.passwordResetToken.findUnique({
    where:  { tokenHash },
    include: { user: { select: { id: true, email: true } } },
  })
  if (!record)                            throw new Error('TOKEN_INVALID')
  if (record.usedAt)                      throw new Error('TOKEN_USED')
  if (record.expiresAt.getTime() < Date.now()) throw new Error('TOKEN_EXPIRED')

  const hashed = await bcrypt.hash(newPassword, 10)

  // Update password + burn token atomically. If either side fails, the
  // whole transaction rolls back so the token isn't burned without the
  // password actually being set.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data:  { password: hashed },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data:  { usedAt: new Date() },
    }),
  ])

  return { id: record.user.id, email: record.user.email }
}
