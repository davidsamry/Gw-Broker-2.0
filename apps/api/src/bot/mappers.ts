// Internal model → Bot API response shape adapters.
//
// The internal types use camelCase (Prisma convention) and Decimal for
// money fields. The Bot API spec uses snake_case and number for money.
// Centralising the conversion here keeps the routes file thin and makes
// the response contract a single import away.

import type { Asset } from '../market-types.js'

/** Internal Account shape (subset Bot API needs). */
export interface AccountIn {
  type:              'REAL' | 'DEMO'
  balance:           { toString(): string } | string | number
  bonusBalance:      { toString(): string } | string | number | null
  rolloverRequired:  { toString(): string } | string | number | null
  rolloverProgress:  { toString(): string } | string | number | null
}

/** Coerce a Prisma Decimal / string / number / null to plain number. */
function toNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

/** Map KycStatus (PENDING/SUBMITTED/APPROVED/REJECTED) → spec value. */
function mapKyc(status: string): string {
  switch (status) {
    case 'APPROVED': return 'approved'
    case 'REJECTED': return 'rejected'
    case 'SUBMITTED': return 'pending'
    default: return 'not_submitted'
  }
}

/** GET /profile response. */
export function mapProfile(args: {
  user: {
    id: string; email: string; name: string; cpf?: string | null;
    phone?: string | null; lastName?: string | null; nickname?: string | null;
    kycStatus: string; blocked: boolean; createdAt: Date;
  }
  accounts: AccountIn[]
}) {
  const real = args.accounts.find((a) => a.type === 'REAL')
  const demo = args.accounts.find((a) => a.type === 'DEMO')

  // first/last/full name — fall back to splitting `name` on the last
  // space if the user never filled the optional lastName field.
  const explicitLast = args.user.lastName?.trim() || null
  const firstName    = explicitLast
    ? args.user.name
    : (args.user.name.split(/\s+/).slice(0, -1).join(' ') || args.user.name)
  const lastName     = explicitLast ?? (args.user.name.split(/\s+/).slice(-1).join('') || '')

  return {
    user_id:             args.user.id,
    email:               args.user.email,
    first_name:          firstName,
    last_name:           lastName,
    full_name:           args.user.name,
    phone:               args.user.phone ?? null,
    cpf:                 args.user.cpf ?? null,
    balance:             toNum(real?.balance),
    demo_balance:        toNum(demo?.balance),
    bonus:               toNum(real?.bonusBalance),
    rollover_required:   toNum(real?.rolloverRequired),
    rollover_completed:  toNum(real?.rolloverProgress),
    is_blocked:          args.user.blocked,
    verification_status: mapKyc(args.user.kycStatus),
    created_at:          args.user.createdAt.toISOString(),
  }
}

/** GET /balance response. Balance comes from the REAL account; demo is
 *  intentionally absent here (use /profile if you need it). */
export function mapBalance(real: AccountIn | undefined) {
  return {
    balance:            toNum(real?.balance),
    bonus:              toNum(real?.bonusBalance),
    rollover_required:  toNum(real?.rolloverRequired),
    rollover_completed: toNum(real?.rolloverProgress),
  }
}

/** Map our internal Asset.type → spec category string. */
function mapCategory(type: Asset['type']): string {
  switch (type) {
    case 'Crypto': return 'crypto'
    case 'Forex':  return 'forex'
    case 'OTC':    return 'otc'
    default:       return 'other'
  }
}

/** GET /assets — one entry per Asset. is_active=true because we filter
 *  disabled IDs out before mapping. */
export function mapAsset(a: Asset) {
  // symbol = compact internal id-like string (EURUSD) for bot UX, not
  // the display label "EUR/USD" which has the slash.
  const compactSymbol = (a.marketSymbol ?? a.symbol).replace(/[^A-Z0-9]/gi, '').toUpperCase()
  return {
    symbol:    compactSymbol,
    name:      a.label || a.symbol,
    category:  mapCategory(a.type),
    payout:    a.payout,
    is_active: true,
  }
}

/** Internal Operation shape (Prisma row). */
export interface OperationIn {
  id:           string
  assetSymbol:  string
  direction:    'CALL' | 'PUT'
  amount:       { toString(): string } | string | number
  payout:       number
  entryPrice:   { toString(): string } | string | number
  exitPrice?:   { toString(): string } | string | number | null
  profit?:      { toString(): string } | string | number | null
  status:       'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  openedAt:     Date
  expiresAt:    Date
  closedAt?:    Date | null
}

/** Operation → spec trade shape (snake_case). */
export function mapTrade(o: OperationIn) {
  // Spec wants direction as 'up'/'down' (matches CALL/PUT semantics).
  const direction = o.direction === 'CALL' ? 'up' : 'down'

  // result is undefined while OPEN; "win" / "loss" / "refund" once
  // resolved. CANCELLED ops returned the stake → "refund" in spec terms.
  let result: string | undefined
  if      (o.status === 'WON')       result = 'win'
  else if (o.status === 'LOST')      result = 'loss'
  else if (o.status === 'CANCELLED') result = 'refund'

  // Compact symbol for bot UX, same rule as mapAsset.
  const symbol = (o.assetSymbol ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()

  return {
    id:                 o.id,
    symbol,
    direction,
    stake:              toNum(o.amount),
    entry_price:        toNum(o.entryPrice),
    exit_price:         o.exitPrice != null ? toNum(o.exitPrice) : null,
    payout_percentage:  o.payout,
    result:             result ?? null,
    profit:             o.profit != null ? toNum(o.profit) : 0,
    status:             o.status === 'OPEN' ? 'open' : 'closed',
    created_at:         o.openedAt.toISOString(),
    expires_at:         o.expiresAt.toISOString(),
    closed_at:          o.closedAt ? o.closedAt.toISOString() : null,
  }
}
