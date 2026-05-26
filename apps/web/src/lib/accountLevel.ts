import { Send, Trophy, Gem, type LucideIcon } from 'lucide-react'

// ── Account level system (by balance) ─────────────────────────────────────
// Promotes users automatically based on their REAL account balance. Each
// level grants a payout bonus that admins can later wire into the trading
// engine (currently informational — same "só salvar" pattern as the
// per-user payout overrides).
//
// Thresholds match the founder's design mock. Currency = BRL.

export type AccountLevel = 'PADRAO' | 'PRO' | 'VIP'

export interface LevelConfig {
  key:          AccountLevel
  name:         string
  minBalance:   number         // R$, inclusive
  payoutBonus:  number          // percentage points added to every asset payout
  description:  string
  /** Lucide icon shown in the header chip when the user is at this level. */
  Icon:         LucideIcon
  /** Tailwind text-color class for the icon + label accents. */
  color:        string
  /** Tailwind bg class for the badge / "active" pill in the modal. */
  bgSoft:       string
  /** Tailwind border class used by the modal card when this level is active. */
  borderSoft:   string
}

export const LEVELS: Record<AccountLevel, LevelConfig> = {
  PADRAO: {
    key:         'PADRAO',
    name:        'PADRÃO',
    minBalance:  0,
    payoutBonus: 0,
    description: 'Nível para iniciantes',
    Icon:        Send,
    color:       'text-emerald-400',
    bgSoft:      'bg-emerald-500/15',
    borderSoft:  'border-emerald-500/40',
  },
  PRO: {
    key:         'PRO',
    name:        'PRÓ',
    minBalance:  5000,
    payoutBonus: 2,
    description: 'Nível para traders casuais',
    Icon:        Trophy,
    color:       'text-orange-400',
    bgSoft:      'bg-orange-500/15',
    borderSoft:  'border-orange-500/40',
  },
  VIP: {
    key:         'VIP',
    name:        'VIP',
    minBalance:  10000,
    payoutBonus: 4,
    description: 'Nível para traders profissionais',
    Icon:        Gem,
    color:       'text-purple-400',
    bgSoft:      'bg-purple-500/15',
    borderSoft:  'border-purple-500/40',
  },
}

/** Ordered list (lowest → highest) — useful for rendering the modal grid. */
export const LEVELS_ORDERED: LevelConfig[] = [LEVELS.PADRAO, LEVELS.PRO, LEVELS.VIP]

/**
 * Compute the user's current level from their REAL balance. Tie-break is
 * "≥ threshold" so a balance of exactly R$ 5,000 lands on PRO.
 */
export function getAccountLevel(balanceBRL: number): LevelConfig {
  if (balanceBRL >= LEVELS.VIP.minBalance)  return LEVELS.VIP
  if (balanceBRL >= LEVELS.PRO.minBalance)  return LEVELS.PRO
  return LEVELS.PADRAO
}
