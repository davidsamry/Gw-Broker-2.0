'use client'

import { Check, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INDICATORS } from '@/lib/indicators'

interface IndicadoresPanelProps {
  activeIds:  Set<string>
  onToggle:   (id: string) => void
  onClearAll: () => void
}

// Compact popover anchored to the indicators (activity) button. Multi-toggle —
// stays open while user picks, closes via outside-click.
export function IndicadoresPanel({ activeIds, onToggle, onClearAll }: IndicadoresPanelProps) {
  return (
    <div
      className="absolute bottom-full mb-1 left-0 bg-[#1d2130] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-50 w-[180px]"
      onClick={(e) => e.stopPropagation()}
    >
      {INDICATORS.map((ind) => {
        const active = activeIds.has(ind.id)
        return (
          <button
            key={ind.id}
            onClick={() => onToggle(ind.id)}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-blue-600/30 text-white'
                : 'text-[#8b8f9a] hover:bg-white/5 hover:text-white'
            )}
          >
            <span
              className="w-3 h-0.5 rounded flex-shrink-0"
              style={{ backgroundColor: ind.color }}
            />
            <span className="flex-1 text-left text-[12px] font-medium">{ind.label}</span>
            {active && <Check size={12} className="text-blue-300 flex-shrink-0" />}
          </button>
        )
      })}

      {activeIds.size > 0 && (
        <button
          onClick={onClearAll}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors border-t border-[#2a2e3b]"
        >
          <Trash2 size={11} />
          Excluir tudo
        </button>
      )}
    </div>
  )
}
