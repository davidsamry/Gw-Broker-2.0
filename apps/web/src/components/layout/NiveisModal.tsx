'use client'

import { useEffect } from 'react'
import { X, Info, Check, Percent, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LEVELS_ORDERED, getAccountLevel, type LevelConfig } from '@/lib/accountLevel'

interface NiveisModalProps {
  realBalance: number   // BRL — used to highlight the user's current level
  onClose:     () => void
}

// ── Account-levels modal ─────────────────────────────────────────────────
// Explains the 3-tier system to the user (PADRÃO / PRÓ / VIP), shows the
// balance threshold for each, and highlights which level the user is at
// based on their REAL balance.
//
// Opens from the AccountDropdown menu. Pure-display today — payout bonus
// values are stored in the LevelConfig but not yet wired into the trading
// engine (intentional MVP scope; same "só salvar" pattern as the admin
// per-user payout overrides).
export function NiveisModal({ realBalance, onClose }: NiveisModalProps) {
  const currentLevel = getAccountLevel(realBalance)

  // Close on ESC.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-stretch justify-center md:items-center md:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full md:max-w-[460px] bg-[#13161f] border border-[#1f232e] shadow-2xl shadow-black/40 overflow-hidden flex flex-col',
          // Mobile: full-screen sheet from bottom; desktop: centered modal.
          'h-full md:h-auto md:max-h-[88vh] md:rounded-2xl',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#1f232e]/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center">
              <Info size={16} className="text-red-400" />
            </div>
            <h2 className="text-base font-bold text-white">Níveis de conta</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {LEVELS_ORDERED.map((lvl) => (
            <LevelCard
              key={lvl.key}
              level={lvl}
              active={lvl.key === currentLevel.key}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function LevelCard({ level, active }: { level: LevelConfig; active: boolean }) {
  const { Icon } = level
  return (
    <div
      className={cn(
        'relative rounded-xl border p-4 transition-colors',
        active
          ? cn(level.bgSoft, level.borderSoft)
          : 'bg-[#1a1e2a] border-[#1f232e]',
      )}
    >
      <div className="flex items-start gap-4">
        {/* Big icon column with active pill underneath */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0 pt-1">
          <div className="relative">
            <div
              className={cn(
                'w-14 h-14 rounded-2xl flex items-center justify-center border',
                level.bgSoft,
                level.borderSoft,
              )}
            >
              <Icon size={28} className={level.color} />
            </div>
            {/* Bonus chip — small badge above-right of the icon */}
            {level.payoutBonus > 0 && (
              <span className={cn(
                'absolute -top-1 -right-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold border',
                level.color,
                level.bgSoft,
                level.borderSoft,
              )}>
                +{level.payoutBonus}%
              </span>
            )}
          </div>

          {/* Active / inactive pill */}
          <span className={cn(
            'px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide',
            active
              ? 'bg-blue-500 text-white'
              : 'bg-[#2a2e3b] text-[#8b8f9a]',
          )}>
            {active ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        {/* Text column */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-white">{level.name}</h3>
            {level.minBalance > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#ccc] bg-[#2a2e3b] border border-[#3a3f50]">
                Saldo de R$ {level.minBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#8b8f9a] font-semibold mt-1">{level.description}</p>

          {/* Feature bullets */}
          <ul className="mt-3 flex flex-col gap-2">
            <FeatureRow
              icon={<Percent size={11} />}
              text={
                level.payoutBonus > 0
                  ? <><strong className="text-white">+{level.payoutBonus}%</strong> Maior porcentagem de lucratividade para todos os instrumentos</>
                  : 'Percentual básico de rentabilidade para todos os instrumentos'
              }
            />
            {level.payoutBonus > 0 && (
              <FeatureRow
                icon={<Tag size={11} />}
                text="Códigos promocionais do mercado em correspondências e promoções"
              />
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

function FeatureRow({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12px] text-[#ccc] leading-snug">
      <span className="w-5 h-5 rounded-md bg-[#252a3a] border border-[#3a3f50] flex items-center justify-center text-[#8b8f9a] flex-shrink-0 mt-0.5">
        {icon}
      </span>
      <span>{text}</span>
    </li>
  )
}

// Keep Check available for future use (e.g., feature checklist variant).
void Check
