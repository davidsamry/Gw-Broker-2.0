'use client'

import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TradingInputsCompactProps {
  timeLabel:       string                              // "01:00"
  timeOptions:     { label: string; value: number }[]  // [{label:'01:00', value:60}, ...]
  selectedTime:    number
  onSelectTime:    (value: number) => void
  investment:      number
  minInvestment:   number
  onAdjustInvestment: (delta: number) => void
  onSetInvestment:    (value: number) => void
}

export function TradingInputsCompact({
  timeLabel, timeOptions, selectedTime, onSelectTime,
  investment, minInvestment, onAdjustInvestment, onSetInvestment,
}: TradingInputsCompactProps) {
  const [timeOpen, setTimeOpen]       = useState(false)
  const [editingInv, setEditingInv]   = useState(false)
  const [invRaw, setInvRaw]           = useState('')

  function commitInv() {
    const n = parseInt(invRaw.replace(/\D/g, ''), 10)
    if (!isNaN(n) && n >= minInvestment) onSetInvestment(n)
    setEditingInv(false)
  }

  const currentIdx = timeOptions.findIndex((t) => t.value === selectedTime)
  const canDecrease = currentIdx > 0
  const canIncrease = currentIdx >= 0 && currentIdx < timeOptions.length - 1

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {/* Cronômetro — mesma layout do Investimento */}
      <div className={cn(
        'relative px-2 py-2 rounded-xl border bg-[#252a3a]/40 transition-all',
        timeOpen ? 'border-blue-500/70 shadow-md shadow-blue-500/10' : 'border-[#2a2e3b]'
      )}>
        <span className="absolute -top-[7px] left-3 px-1.5 bg-[#1d2130] text-[9px] font-bold text-[#8b8f9a] tracking-widest">
          TEMPO
        </span>
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            onClick={() => { if (canDecrease) onSelectTime(timeOptions[currentIdx - 1].value) }}
            disabled={!canDecrease}
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus size={12} />
          </button>
          <div className="flex-1 text-center">
            <button
              onClick={() => setTimeOpen((v) => !v)}
              className="text-base font-bold text-white font-mono tracking-wider hover:text-blue-300 leading-none w-full"
            >
              {timeLabel}
            </button>
          </div>
          <button
            onClick={() => { if (canIncrease) onSelectTime(timeOptions[currentIdx + 1].value) }}
            disabled={!canIncrease}
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
          </button>
        </div>
        {timeOpen && (
          <div
            className="absolute top-full mt-1.5 left-0 right-0 z-30 bg-[#1a1e2e] border border-[#2a2e3b] rounded-xl shadow-2xl shadow-black/40 p-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-1">
              {timeOptions.map((t) => (
                <button
                  key={t.value}
                  onClick={() => { onSelectTime(t.value); setTimeOpen(false) }}
                  className={cn(
                    'py-1.5 text-[11px] font-bold rounded-lg transition-colors',
                    t.value === selectedTime
                      ? 'bg-blue-600 text-white'
                      : 'text-[#8b8f9a] hover:bg-white/5 hover:text-white'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Valor */}
      <div className="relative px-2 py-2 rounded-xl border border-[#2a2e3b] bg-[#252a3a]/40">
        <span className="absolute -top-[7px] left-3 px-1.5 bg-[#1d2130] text-[9px] font-bold text-[#8b8f9a] tracking-widest">
          VALOR
        </span>
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            onClick={() => onAdjustInvestment(-10)}
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors flex-shrink-0"
          >
            <Minus size={12} />
          </button>
          <div className="flex-1 text-center">
            {editingInv ? (
              <input
                autoFocus
                inputMode="numeric"
                value={invRaw}
                onChange={(e) => setInvRaw(e.target.value.replace(/\D/g, ''))}
                onBlur={commitInv}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitInv()
                  if (e.key === 'Escape') setEditingInv(false)
                }}
                className="w-full bg-transparent text-base font-bold text-white text-center outline-none border-b border-blue-500"
              />
            ) : (
              <button
                onClick={() => { setInvRaw(''); setEditingInv(true) }}
                className="text-base font-bold text-white hover:text-blue-300 leading-none w-full"
              >
                R$ {investment}
              </button>
            )}
          </div>
          <button
            onClick={() => onAdjustInvestment(10)}
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors flex-shrink-0"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
