'use client'

import { useState } from 'react'
import { Shield, Percent, Gift, X, HelpCircle, Clock, CheckCircle2, ChevronRight, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'

type PromoCode = {
  code: string
  status: 'active' | 'expired'
  date: string
  label?: string
}

type MarketCard = {
  id: string
  title: string
  iconBg: string
  icon: React.ReactNode
  codesAvailable: number
  codesColor: string
  codes: PromoCode[]
  extraButton?: string
}

const MARKET_CARDS: MarketCard[] = [
  {
    id: 'risco-livre',
    title: 'Risco Livre',
    iconBg: 'bg-blue-500',
    icon: <Shield size={22} className="text-white" />,
    codesAvailable: 0,
    codesColor: 'text-[#8b8f9a]',
    codes: [],
    extraButton: '15R$ grátis',
  },
  {
    id: 'dinheiro-volta',
    title: 'Dinheiro de volta',
    iconBg: 'bg-purple-500',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
        <path d="M12 2C9.243 2 7 4.243 7 7v1H5c-1.103 0-2 .897-2 2v10c0 1.103.897 2 2 2h14c1.103 0 2-.897 2-2V10c0-1.103-.897-2-2-2h-2V7c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3v1H9V7c0-1.654 1.346-3 3-3zm1 10.722V17h-2v-2.278A1.993 1.993 0 0 1 10 13c0-1.103.897-2 2-2s2 .897 2 2a1.993 1.993 0 0 1-1 1.722z"/>
      </svg>
    ),
    codesAvailable: 0,
    codesColor: 'text-[#8b8f9a]',
    codes: [
      { code: 'sLpI6ApvWd (20%)', status: 'expired', date: '22/11/2022', label: 'Data expirada' },
    ],
  },
  {
    id: 'bonus-deposito',
    title: 'Bônus de Depósito',
    iconBg: 'bg-orange-500',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
        <path d="M12 1C8.676 1 6 2.341 6 4v3c0 1.302 1.574 2.43 4 2.85V12h-1v1h1v1h-1v1h1v3h2v-3h1v-1h-1v-1h1v-1h-1V9.85c2.426-.42 4-1.548 4-2.85V4c0-1.659-2.676-3-6-3zm0 2c2.761 0 4 .895 4 1 0 .105-1.239 1-4 1S8 4.105 8 4c0-.105 1.239-1 4-1z"/>
      </svg>
    ),
    codesAvailable: 4,
    codesColor: 'text-teal-400',
    codes: [
      { code: 'DEPOSIT30 (30%)', status: 'active', date: '28/10/2030' },
      { code: 'DEPOSIT40 (40%)', status: 'active', date: '28/10/2030' },
      { code: 'DEPOSIT50 (50%)', status: 'active', date: '28/10/2030' },
    ],
  },
  {
    id: 'percentual',
    title: 'Percentual de faturamento',
    iconBg: 'bg-pink-500',
    icon: <Percent size={20} className="text-white" />,
    codesAvailable: 0,
    codesColor: 'text-[#8b8f9a]',
    codes: [],
  },
  {
    id: 'bonus-saldo',
    title: 'Bônus de saldo',
    iconBg: 'bg-blue-600',
    icon: <Gift size={20} className="text-white" />,
    codesAvailable: 0,
    codesColor: 'text-[#8b8f9a]',
    codes: [],
  },
  {
    id: 'cancelar-pontos',
    title: 'Cancelar X pontos',
    iconBg: 'bg-teal-500',
    icon: <X size={20} className="text-white" />,
    codesAvailable: 0,
    codesColor: 'text-[#8b8f9a]',
    codes: [],
  },
]

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
      <ClipboardList size={36} className="text-[#3a3f50] mb-3" />
      <p className="text-xs text-[#8b8f9a] leading-relaxed max-w-[200px]">
        Você ainda não tem um histórico de códigos promocionais. Você pode adicionar um código promocional usando o botão abaixo.
      </p>
    </div>
  )
}

function MarketCard({ card }: { card: MarketCard }) {
  return (
    <div className="flex flex-col bg-[#1a1e2e] border border-[#2a2e3b] rounded-2xl overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', card.iconBg)}>
          {card.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white">{card.title}</div>
          <div className={cn('text-[10px] font-semibold tracking-wide mt-0.5 uppercase', card.codesColor)}>
            {card.codesAvailable} CÓDIGOS PROMOCIONAIS DISPONÍVEIS
          </div>
        </div>
        <button className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0 hover:bg-blue-500/30 transition-colors">
          <HelpCircle size={12} className="text-blue-400" />
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 border-t border-[#2a2e3b]">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-4 py-2">
          <span className="text-[9px] font-semibold text-[#8b8f9a] tracking-widest uppercase">Código Promocional</span>
          <span className="text-[9px] font-semibold text-[#8b8f9a] tracking-widest uppercase">Status</span>
          <span className="text-[9px] font-semibold text-[#8b8f9a] tracking-widest uppercase">Usando</span>
        </div>

        {card.codes.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col">
            {card.codes.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px] gap-2 px-4 py-2.5 border-t border-[#2a2e3b]/60 items-center hover:bg-white/[0.02] transition-colors">
                <span className="text-xs font-semibold text-white truncate">{c.code}</span>
                <div className="flex items-center gap-1.5">
                  {c.status === 'active' ? (
                    <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                      <X size={8} className="text-white" />
                    </div>
                  )}
                  <span className={cn('text-[10px] font-medium', c.status === 'active' ? 'text-[#8b8f9a]' : 'text-[#8b8f9a]')}>
                    {c.date}
                  </span>
                </div>
                <div>
                  {c.status === 'active' ? (
                    <button className="flex items-center gap-0.5 text-blue-400 hover:text-blue-300 transition-colors text-xs font-semibold">
                      Use-o <ChevronRight size={12} />
                    </button>
                  ) : (
                    <span className="text-[10px] text-[#8b8f9a]">{c.label}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#151822] border-t border-[#2a2e3b]">
        <button className="flex items-center gap-1.5 text-xs text-[#8b8f9a] hover:text-white transition-colors">
          <Clock size={12} />
          Mostrar todo o histórico
        </button>
        <div className="flex items-center gap-2">
          {card.extraButton && (
            <button className="px-3 py-1.5 rounded-lg bg-[#2a2e3b] text-xs font-semibold text-white hover:bg-[#3a3f50] transition-colors">
              {card.extraButton}
            </button>
          )}
          <button className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 transition-colors text-xs font-bold text-white">
            Insira o código
          </button>
        </div>
      </div>

    </div>
  )
}

export function MercadoPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#151822] min-h-0 overflow-hidden">

      {/* Same top tabs as ContaPage for consistency */}
      <div className="flex items-center px-6 border-b border-[#2a2e3b] bg-[#1a1e2e] flex-shrink-0 gap-1">
        {(['Retirada','Transações','Operações','Minha Conta','Mercado','Torneios','Análise'] as const).map((t) => (
          <button
            key={t}
            className={cn(
              'px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              t === 'Mercado'
                ? 'text-white border-white font-semibold'
                : 'text-[#8b8f9a] border-transparent hover:text-white'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Grid of cards */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="grid grid-cols-3 gap-4">
          {MARKET_CARDS.map((card) => (
            <MarketCard key={card.id} card={card} />
          ))}
        </div>
      </div>

    </div>
  )
}
