'use client'

// Welcome bonus modal — shown automatically once per login session so the
// trader sees the active promo the moment they land on the trade page.
//
// Rules:
//   • Pops the highest-value PERCENTAGE bonus (falls back to first FIXED
//     when no PERCENTAGE exists). Admin-managed via /admin/bonus.
//   • One-shot per session: sessionStorage flag survives reloads but is
//     cleared on logout/new tab/new browser session.
//   • Silent no-op when the user has no bonuses available (e.g. all
//     already redeemed, none active) — no empty modal.
//   • Click X, backdrop, or "Depositar agora" all close the modal. The
//     deposit click ALSO opens the deposit flow with the bonus code
//     pre-filled (parent handles via onDeposit prop).

import { useEffect, useState } from 'react'
import { X, Check, Gift, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'

interface AvailableBonus {
  id:         string
  code:       string
  type:       'PERCENTAGE' | 'FIXED'
  value:      number
  minDeposit: number
  rollover:   number
}

interface BonusWelcomeModalProps {
  /** True once the user is hydrated AND authenticated. Modal stays hidden
   *  until then to avoid a flash on /login or during the initial /auth/me. */
  enabled:    boolean
  /** Fires when the user clicks the CTA. Receives the bonus code so the
   *  parent can open DepositoModal with the field pre-filled. */
  onDeposit:  (code: string) => void
}

const SESSION_FLAG_KEY = 'vx_welcome_bonus_seen'

function loadSessionFlag(): boolean {
  if (typeof window === 'undefined') return true
  try { return sessionStorage.getItem(SESSION_FLAG_KEY) === '1' }
  catch { return true }   // private mode → treat as already-seen, don't pester
}

function saveSessionFlag(): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(SESSION_FLAG_KEY, '1') } catch { /* ignore */ }
}

function formatBrl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// Pick the most attention-grabbing bonus to show. PERCENTAGE > FIXED
// because "200%" reads stronger than "R$ 100"; within type, highest value.
function pickHero(bonuses: AvailableBonus[]): AvailableBonus | null {
  if (bonuses.length === 0) return null
  const pcts = bonuses.filter(b => b.type === 'PERCENTAGE')
  const pool = pcts.length > 0 ? pcts : bonuses
  return pool.reduce((best, b) => b.value > best.value ? b : best, pool[0])
}

export function BonusWelcomeModal({ enabled, onDeposit }: BonusWelcomeModalProps) {
  const [hero,   setHero]   = useState<AvailableBonus | null>(null)
  const [closed, setClosed] = useState(true)  // start hidden — flipped on after fetch

  useEffect(() => {
    if (!enabled) return
    if (loadSessionFlag()) return   // already seen this session

    let cancelled = false
    api.get<{ bonuses: AvailableBonus[] }>('/bonuses/available')
      .then(({ data }) => {
        if (cancelled) return
        const pick = pickHero(data.bonuses ?? [])
        if (pick) {
          setHero(pick)
          setClosed(false)
        }
      })
      .catch(() => { /* silent — no modal is the safe fallback */ })
    return () => { cancelled = true }
  }, [enabled])

  function dismiss() {
    setClosed(true)
    saveSessionFlag()
  }

  if (closed || !hero) return null

  const title = hero.type === 'PERCENTAGE'
    ? `Ganhe ${hero.value}% de bônus no depósito!`
    : `Ganhe R$ ${formatBrl(hero.value)} de bônus!`

  const bullets = [
    `Deposite com o código **${hero.code}** e receba bônus direto no saldo!`,
    `Depósito mínimo: R$ ${formatBrl(hero.minDeposit)}`,
    'Bônus aplicado automaticamente ao confirmar depósito',
  ]

  return (
    // Fixed-position overlay covers the full viewport. z-[100] sits above
    // every chart/header/sidebar layer (max in the app is z-50).
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={dismiss}    // click outside the card = dismiss
    >
      <div
        onClick={(e) => e.stopPropagation()}   // keep clicks inside from closing
        // Brand gradient — matches the Vx Global logo's blue. Same depth
        // as the original purple but anchored to the broker's palette so
        // it reads as "the platform" rather than a third-party promo.
        className="relative w-full max-w-sm rounded-2xl p-5 overflow-hidden bg-gradient-to-br from-[#1d4ed8] via-[#2563eb] to-[#1e40af] shadow-2xl shadow-blue-900/50"
      >
        {/* Subtle glow accent — purely decorative */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-blue-300/25 blur-2xl pointer-events-none" />

        {/* Close X — top right, slightly larger tap target than the chart
            result card since this is a top-level interruption. */}
        <button
          onClick={dismiss}
          aria-label="Fechar"
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors z-10"
        >
          <X size={16} />
        </button>

        <div className="flex items-start justify-between gap-3 mb-4 relative pr-7">
          <h3 className="text-[18px] font-bold text-white leading-snug">{title}</h3>
          <Gift size={24} className="text-white/90 flex-shrink-0 mt-0.5" />
        </div>

        <ul className="flex flex-col gap-2.5 mb-5 relative">
          {bullets.map((text, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-white/95 leading-snug">
              <Check size={14} className="text-white/90 flex-shrink-0 mt-0.5" strokeWidth={3} />
              <span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-white">$1</strong>') }} />
            </li>
          ))}
        </ul>

        <button
          onClick={() => { onDeposit(hero.code); dismiss() }}
          className="w-full flex items-center justify-center gap-2 bg-white text-[#1e3a8a] font-bold text-sm py-3 rounded-xl hover:bg-white/90 transition-colors relative"
        >
          <span>Depositar agora</span>
          <ArrowRight size={14} className="text-[#1e3a8a]" />
        </button>
      </div>
    </div>
  )
}
