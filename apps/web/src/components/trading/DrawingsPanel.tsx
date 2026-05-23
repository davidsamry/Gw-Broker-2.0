'use client'

import { X, Check, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DRAWING_TOOLS, type DrawingToolId } from '@/lib/drawings'

interface DrawingsPanelProps {
  onClose:      () => void
  onSelectTool: (id: DrawingToolId) => void
  onClearAll:   () => void
  activeTool:   DrawingToolId | null
  hasDrawings:  boolean
}

export function DrawingsPanel({ onClose, onSelectTool, onClearAll, activeTool, hasDrawings }: DrawingsPanelProps) {
  return (
    <div className="absolute top-0 left-0 h-full z-30 flex" style={{ width: 220 }}>
      <div className="flex flex-col w-full bg-[#1a1e2e] border-r border-[#2a2e3b] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e3b] flex-shrink-0">
          <h2 className="text-sm font-bold text-white">Desenhos</h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-[#8b8f9a] hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tip line */}
        <div className="px-4 pt-3 pb-2 text-[11px] text-[#8b8f9a] leading-snug">
          {activeTool
            ? 'Clique no gráfico para posicionar.'
            : 'Selecione uma ferramenta abaixo.'}
        </div>

        {/* Tools list */}
        <div className="flex-1 overflow-y-auto">
          {DRAWING_TOOLS.map((tool) => {
            const active = activeTool === tool.id
            return (
              <button
                key={tool.id}
                onClick={() => onSelectTool(tool.id)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors group',
                  active ? 'bg-blue-600/30' : 'hover:bg-white/5'
                )}
              >
                <span className={cn('text-[13px] font-medium', active ? 'text-white' : 'text-white')}>
                  {tool.label}
                </span>
                {active && <Check size={14} className="text-blue-300 flex-shrink-0" />}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        {hasDrawings && (
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
