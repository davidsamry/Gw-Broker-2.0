'use client'

import { useState } from 'react'
import { X, Check, ChevronRight, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BonusPanelProps {
  onClose: () => void
}

type Tab = 'DISPONIVEL' | 'NOTICIAS'

const BONUSES = [
  {
    id:      'WELCOME100',
    title:   'Ganhe 100% de bônus no depósito!',
    code:    'WELCOME100',
    emoji:   '💰',
    bullets: [
      'Deposite com o código **WELCOME100** e receba bônus direto no saldo!',
      'Depósito mínimo: R$ 100',
      'Bônus aplicado automaticamente ao confirmar depósito',
    ],
  },
]

export function BonusPanel({ onClose }: BonusPanelProps) {
  const [tab, setTab]       = useState<Tab>('DISPONIVEL')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function copyCode(code: string) {
    navigator.clipboard?.writeText(code)
    setCopiedId(code)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="flex flex-col bg-[#1a1e2e] border-r border-[#2a2e3b] flex-shrink-0" style={{ width: 320 }}>
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
        {tab === 'DISPONIVEL' && BONUSES.map((b) => (
          <BonusCard key={b.id} bonus={b} copied={copiedId === b.code} onCopy={() => copyCode(b.code)} />
        ))}
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

function BonusCard({ bonus, copied, onCopy }: {
  bonus: typeof BONUSES[number]
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="relative rounded-2xl p-4 overflow-hidden bg-gradient-to-br from-[#6b46c1] via-[#7c3aed] to-[#5b21b6] shadow-xl shadow-purple-900/30">
      {/* Background blob */}
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-purple-400/20 blur-2xl pointer-events-none" />

      {/* Title + emoji */}
      <div className="flex items-start justify-between gap-2 mb-3 relative">
        <h3 className="text-[15px] font-bold text-white leading-snug">
          {bonus.title}
        </h3>
        <span className="text-2xl flex-shrink-0">{bonus.emoji}</span>
      </div>

      {/* Bullets */}
      <ul className="flex flex-col gap-2 mb-4 relative">
        {bonus.bullets.map((text, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] text-white/90 leading-snug">
            <Check size={13} className="text-white/90 flex-shrink-0 mt-0.5" strokeWidth={3} />
            <span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-white">$1</strong>') }} />
          </li>
        ))}
      </ul>

      {/* Copy button */}
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
