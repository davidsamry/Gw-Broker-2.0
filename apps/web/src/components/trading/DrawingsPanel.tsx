'use client'

import { Check, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DRAWING_TOOLS, type DrawingToolId } from '@/lib/drawings'

interface DrawingsPanelProps {
  onSelectTool: (id: DrawingToolId) => void
  onClearAll:   () => void
  activeTool:   DrawingToolId | null
  hasDrawings:  boolean
}

// Compact popover anchored to the pencil button — matches the visual style
// of the timeframe and chart-type pickers (bottom-full mb-1 left-0).
export function DrawingsPanel({ onSelectTool, onClearAll, activeTool, hasDrawings }: DrawingsPanelProps) {
  return (
    <div
      className="absolute bottom-full mb-1 left-0 bg-[#1d2130] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-50 w-[180px]"
      onClick={(e) => e.stopPropagation()}
    >
      {DRAWING_TOOLS.map((tool) => {
        const active = activeTool === tool.id
        return (
          <button
            key={tool.id}
            onClick={() => onSelectTool(tool.id)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-blue-600/30 text-white'
                : 'text-[#8b8f9a] hover:bg-white/5 hover:text-white'
            )}
          >
            <span className="text-[12px] font-medium">{tool.label}</span>
            {active && <Check size={12} className="text-blue-300 flex-shrink-0" />}
          </button>
        )
      })}

      {hasDrawings && (
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
