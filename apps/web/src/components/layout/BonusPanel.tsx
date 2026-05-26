'use client'

// User-facing bonus panel — sidebar on desktop, full screen on mobile.
// Lists ACTIVE bonus codes the user can redeem (filtered by the API:
// active, not expired, not maxed-out per user, no open grant).
//
// Powered by GET /bonuses/available (same endpoint the deposit modal
// uses to populate its dropdown). Replaces the previous hardcoded
// WELCOME100 card.

import { useEffect, useState } from 'react'
import { X, Check, Loader2, Gift, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface BonusPanelProps {
  onClose:    () => void
  // Triggered when the user clicks "Depositar" on a bonus card. The parent
  // opens the deposit modal pre-filled with this code so the user doesn't
  // have to paste it manually.
  onDeposit?: (code: string) => void
}

type Tab = 'DISPONIVEL' | 'NOTICIAS'

// Mirrors apps/api/src/bonuses/service.ts AvailableBonus.
interface AvailableBonus {
  id:         string
  code:       string
  type:       'PERCENTAGE' | 'FIXED'
  value:      number
  minDeposit: number
  rollover:   number
}

function formatBrl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ── Cache (localStorage) — SWR so the card paints instantly when the user
// reopens the BÔNUS tab. The list rarely changes (admin-managed), so a
// 5-min TTL is plenty fresh. Inline here instead of a zustand store —
// only one consumer.
const BONUS_CACHE_KEY = 'vx_bonuses_available_cache_v1'
const BONUS_CACHE_TTL = 5 * 60 * 1000

interface BonusCache { bonuses: AvailableBonus[]; savedAt: number }

function loadBonusCache(): AvailableBonus[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(BONUS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BonusCache
    if (Date.now() - parsed.savedAt > BONUS_CACHE_TTL) return null
    return Array.isArray(parsed.bonuses) ? parsed.bonuses : null
  } catch {
    return null
  }
}

function saveBonusCache(bonuses: AvailableBonus[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(BONUS_CACHE_KEY, JSON.stringify({ bonuses, savedAt: Date.now() }))
  } catch { /* quota / private mode — ignore */ }
}

export function BonusPanel({ onClose, onDeposit }: BonusPanelProps) {
  const [tab, setTab]       = useState<Tab>('DISPONIVEL')
  // Seed from cache so the card appears in <16ms on reopen. If cache is
  // empty/expired we start with [] + loading=true (original behavior).
  const [bonuses, setBonuses] = useState<AvailableBonus[]>(() => loadBonusCache() ?? [])
  const [loading, setLoading] = useState(() => loadBonusCache() == null)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(false)
    api.get<{ bonuses: AvailableBonus[] }>('/bonuses/available')
      .then(({ data }) => {
        if (cancelled) return
        setBonuses(data.bonuses)
        saveBonusCache(data.bonuses)
      })
      .catch(() => {
        // Only show the error state if we have nothing cached to fall back on.
        if (!cancelled && bonuses.length === 0) setError(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startDeposit(code: string) {
    onDeposit?.(code)
  }

  return (
    <div className="flex flex-col bg-[#1a1e2e] md:border-r border-[#2a2e3b] flex-shrink-0 w-full h-full md:w-[320px]">
      {/* Header tabs + close */}
      <div className="flex items-center border-b border-[#2a2e3b] pr-2">
        <div className="flex flex-1">
          <TabBtn active={tab === 'DISPONIVEL'} onClick={() => setTab('DISPONIVEL')} label="Disponível" />
          <TabBtn active={tab === 'NOTICIAS'}    onClick={() => setTab('NOTICIAS')}   label="Notícias" />
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {tab === 'DISPONIVEL' && (
          loading
            ? (
              <div className="flex-1 flex items-center justify-center text-[#8b8f9a]">
                <Loader2 size={20} className="animate-spin" />
              </div>
            )
            : error
              ? (
                <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
                  <p className="text-[13px] text-[#8b8f9a]">Não foi possível carregar os bônus.</p>
                </div>
              )
              : bonuses.length === 0
                ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center gap-2">
                    <Gift size={28} className="text-[#5d6275]" />
                    <p className="text-[13px] text-[#8b8f9a]">Sem códigos disponíveis no momento.</p>
                    <p className="text-[11px] text-[#5d6275]">Volte mais tarde — novos códigos aparecem aqui.</p>
                  </div>
                )
                : bonuses.map((b) => (
                  <BonusCard
                    key={b.id}
                    bonus={b}
                    onDeposit={() => startDeposit(b.code)}
                  />
                ))
        )}
        {tab === 'NOTICIAS' && (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
            <p className="text-[13px] text-[#8b8f9a]">Sem novidades por aqui ainda.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 px-4 py-3.5 text-sm font-bold tracking-wider uppercase transition-colors relative',
        // Project accent blue — matches the asset-tab underline in Header.tsx
        // and the gradient CTAs elsewhere.
        active ? 'text-blue-400' : 'text-[#8b8f9a] hover:text-white'
      )}
    >
      {label}
      {active && (
        <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-blue-500 rounded-t" />
      )}
    </button>
  )
}

// Title + bullets derived from the bonus shape — keeps the card visually
// rich without needing extra fields in the API. PERCENTAGE codes brag
// the percentage; FIXED codes brag the R$ amount.
function buildTitle(b: AvailableBonus): string {
  return b.type === 'PERCENTAGE'
    ? `Ganhe ${b.value}% de bônus no depósito!`
    : `Ganhe R$ ${formatBrl(b.value)} de bônus!`
}

function buildBullets(b: AvailableBonus): string[] {
  return [
    `Deposite com o código **${b.code}** e receba bônus direto no saldo!`,
    `Depósito mínimo: R$ ${formatBrl(b.minDeposit)}`,
    'Bônus aplicado automaticamente ao confirmar depósito',
  ]
}

function BonusCard({ bonus, onDeposit }: {
  bonus: AvailableBonus
  onDeposit: () => void
}) {
  const title   = buildTitle(bonus)
  const bullets = buildBullets(bonus)
  return (
    <div className="relative rounded-2xl p-4 overflow-hidden bg-gradient-to-br from-[#1d4ed8] via-[#2563eb] to-[#1e40af] shadow-xl shadow-blue-900/40">
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-blue-300/25 blur-2xl pointer-events-none" />

      <div className="flex items-start justify-between gap-2 mb-3 relative">
        <h3 className="text-[15px] font-bold text-white leading-snug">{title}</h3>
        <Gift size={20} className="text-white/90 flex-shrink-0 mt-0.5" />
      </div>

      <ul className="flex flex-col gap-2 mb-4 relative">
        {bullets.map((text, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] text-white/90 leading-snug">
            <Check size={13} className="text-white/90 flex-shrink-0 mt-0.5" strokeWidth={3} />
            <span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-white">$1</strong>') }} />
          </li>
        ))}
      </ul>

      <button
        onClick={onDeposit}
        className="w-full flex items-center justify-center gap-2 bg-white text-[#1e3a8a] font-bold text-sm py-3 rounded-xl hover:bg-white/90 transition-colors relative"
      >
        <span>Depositar agora</span>
        <ArrowRight size={14} className="text-[#1e3a8a]" />
      </button>
    </div>
  )
}
