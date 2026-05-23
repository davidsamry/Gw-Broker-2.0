'use client'

import { X, Check, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INDICATORS, type IndicatorDef } from '@/lib/indicators'

interface IndicadoresPanelProps {
  onClose:    () => void
  activeIds:  Set<string>
  onToggle:   (id: string) => void
  onClearAll: () => void
}

function IndicatorRow({ indicator, active, onToggle }: { indicator: IndicatorDef; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors group',
        active ? 'bg-[#252a3a]' : 'hover:bg-white/5'
      )}
    >
      {/* Color swatch — matches the line color drawn on the chart */}
      <span
        className="w-3 h-0.5 flex-shrink-0 rounded"
        style={{ backgroundColor: indicator.color }}
      />
      <span className="text-[13px] font-medium text-white flex-1">{indicator.label}</span>
      {active && <Check size={14} className="text-blue-400 flex-shrink-0" />}
    </button>
  )
}

export function IndicadoresPanel({ onClose, activeIds, onToggle, onClearAll }: IndicadoresPanelProps) {
  return (
    <div className="absolute top-0 left-0 h-full z-30 flex" style={{ width: 200 }}>
      <div className="flex flex-col w-full bg-[#1a1e2e] border-r border-[#2a2e3b] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e3b] flex-shrink-0">
          <h2 className="text-sm font-bold text-white">Indicadores</h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-[#8b8f9a] hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-4 pb-1">
            <span className="text-[10px] font-bold text-[#8b8f9a] tracking-widest">INDICADORES</span>
          </div>
          {INDICATORS.map((ind) => (
            <IndicatorRow
              key={ind.id}
              indicator={ind}
              active={activeIds.has(ind.id)}
              onToggle={() => onToggle(ind.id)}
            />
          ))}
        </div>

        {/* Footer */}
        {activeIds.size > 0 && (
          <div className="border-t border-[#2a2e3b] p-3 flex-shrink-0">
            <button
              onClick={onClearAll}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors text-sm font-semibold"
            >
              <Trash2 size={13} />
              Excluir tudo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
