'use client'

// User-facing bonus panel — sidebar on desktop, full screen on mobile.
// Lists ACTIVE bonus codes the user can redeem (filtered by the API:
// active, not expired, not maxed-out per user, no open grant).
//
// Powered by GET /bonuses/available (same endpoint the deposit modal
// uses to populate its dropdown). Replaces the previous hardcoded
// WELCOME100 card.

import { useEffect, useState } from 'react'
import { X, Check, ChevronRight, Copy, Loader2, Gift } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface BonusPanelProps {
  onClose: () => void
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

export function BonusPanel({ onClose }: BonusPanelProps) {
  const [tab, setTab]       = useState<Tab>('DISPONIVEL')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [bonuses, setBonuses] = useState<AvailableBonus[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    api.get<{ bonuses: AvailableBonus[] }>('/bonuses/available')
      .then(({ data }) => { if (!cancelled) setBonuses(data.bonuses) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function copyCode(code: string) {
    navigator.clipboard?.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
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
                    copied={copiedCode === b.code}
                    onCopy={() => copyCode(b.code)}
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
        active ? 'text-orange-400' : 'text-[#8b8f9a] hover:text-white'
      )}
    >
      {label}
      {active && (
        <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-orange-400 rounded-t" />
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

function BonusCard({ bonus, copied, onCopy }: {
  bonus: AvailableBonus
  copied: boolean
  onCopy: () => void
}) {
  const title   = buildTitle(bonus)
  const bullets = buildBullets(bonus)
  return (
    <div className="relative rounded-2xl p-4 overflow-hidden bg-gradient-to-br from-[#6b46c1] via-[#7c3aed] to-[#5b21b6] shadow-xl shadow-purple-900/30">
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-purple-400/20 blur-2xl pointer-events-none" />

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
        onClick={onCopy}
        className="w-full flex items-center justify-center gap-2 bg-white text-[#3a2a5a] font-bold text-sm py-3 rounded-xl hover:bg-white/90 transition-colors relative"
      >
        {copied ? <Copy size={14} /> : null}
        <span>{copied ? 'Código copiado!' : 'Copiar código'}</span>
        {!copied && <ChevronRight size={14} className="text-[#3a2a5a]" />}
      </button>
    </div>
  )
}
