import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'

// Wraps the OTPAuth library + QR rendering. Single source of truth for
// 2FA primitives — issuer, label format, time window, code length.
//
// We use a 30-second time-step and accept the previous + current + next
// window (±30s) to absorb device clock drift. The default is fine for
// Google Authenticator, Authy, 1Password, etc.

const ISSUER  = 'VX Global'
const DIGITS  = 6
const PERIOD  = 30
const WINDOW  = 1   // ± WINDOW periods accepted

function makeTOTP(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer:    ISSUER,
    label,
    algorithm: 'SHA1',
    digits:    DIGITS,
    period:    PERIOD,
    secret:    OTPAuth.Secret.fromBase32(secretBase32),
  })
}

/** Generate a new base32 secret (random 20 bytes). */
export function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32
}

/** Build the otpauth:// URL the user scans / pastes into their authenticator. */
export function otpauthUrl(secretBase32: string, accountLabel: string): string {
  return makeTOTP(secretBase32, accountLabel).toString()
}

/** Render the otpauth URL as a base64 PNG data URL (for <img src=...>) */
export async function qrCodeDataUrl(secretBase32: string, accountLabel: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl(secretBase32, accountLabel), {
    errorCorrectionLevel: 'M',
    width: 240,
    margin: 1,
    color: { dark: '#0f1117', light: '#ffffff' },
  })
}

/** Verify a 6-digit TOTP code against a stored secret (with drift tolerance). */
export function verifyTotp(secretBase32: string, code: string): boolean {
  if (!secretBase32) return false
  const cleaned = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  const totp  = makeTOTP(secretBase32, 'verify')
  const delta = totp.validate({ token: cleaned, window: WINDOW })
  return delta !== null
}
