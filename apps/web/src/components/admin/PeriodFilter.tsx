'use client'

import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PeriodPreset = 'hoje' | 'ontem' | '7d' | '15d' | '30d' | 'custom'

export interface PeriodRange { from: Date; to: Date }

// Compute date range from preset key. Returns { from, to } in local time.
export function rangeFromPreset(preset: Exclude<PeriodPreset, 'custom'>): PeriodRange {
  const now = new Date()
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const endOfDay   = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

  switch (preset) {
    case 'hoje':  return { from: startOfDay(now), to: now }
    case 'ontem': {
      const y = new Date(now); y.setDate(y.getDate() - 1)
      return { from: startOfDay(y), to: endOfDay(y) }
    }
    case '7d':  return { from: startOfDay(new Date(now.getTime() -  7 * 86400_000)), to: now }
    case '15d': return { from: startOfDay(new Date(now.getTime() - 15 * 86400_000)), to: now }
    case '30d': return { from: startOfDay(new Date(now.getTime() - 30 * 86400_000)), to: now }
  }
}

const PRESETS: Array<{ key: Exclude<PeriodPreset, 'custom'>; label: string }> = [
  { key: 'hoje',  label: 'Hoje'    },
  { key: 'ontem', label: 'Ontem'   },
  { key: '7d',    label: '7 dias'  },
  { key: '15d',   label: '15 dias' },
  { key: '30d',   label: '30 dias' },
]

interface PeriodFilterProps {
  active:   PeriodPreset
  onChange: (preset: Exclude<PeriodPreset, 'custom'>) => void
}

export function PeriodFilter({ active, onChange }: PeriodFilterProps) {
  return (
    <div className="bg-[#13161f] border border-[#1f232e] rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-[#8b8f9a] mr-1">Período:</span>
      {PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
            active === p.key
              ? 'bg-emerald-500 text-black'
              : 'bg-[#1a1e2a] text-[#8b8f9a] hover:text-white border border-[#1f232e]'
          )}
        >
          {p.label}
        </button>
      ))}
      {/* Custom range placeholders — to be wired in a follow-up commit */}
      <div className="flex items-center gap-2 ml-auto opacity-50">
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#1a1e2a] border border-[#1f232e] text-[#8b8f9a]" disabled>
          <Calendar size={11} /> De
        </button>
        <span className="text-xs text-[#8b8f9a]">até</span>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#1a1e2a] border border-[#1f232e] text-[#8b8f9a]" disabled>
          <Calendar size={11} /> Até
        </button>
      </div>
    </div>
  )
}
