'use client'

import { X, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

const DRAWING_TOOLS = [
  { label: 'Linha horizontal' },
  { label: 'Faixa de preço' },
  { label: 'Parte superior/inferior plana' },
  { label: 'Canal separado', dot: '#ef4444' },
  { label: 'Arco' },
  { label: 'Linha Cruzada' },
  { label: 'Caixa Gann' },
  { label: 'Ângulo de tendência' },
  { label: 'Curva' },
  { label: 'Data e faixa de preço' },
  { label: 'Pitchfan' },
  { label: 'Triângulo' },
  { label: 'Retração de Fibonacci' },
  { label: 'Canal paralelo' },
  { label: 'Pitchfork' },
  { label: 'Leque de Fibonacci' },
  { label: 'Período' },
  { label: 'Raio' },
  { label: 'Linha Estendida' },
  { label: 'Retângulo' },
  { label: 'Linha vertical' },
  { label: 'Linha de trend' },
]

interface DrawingsPanelProps {
  onClose: () => void
}

export function DrawingsPanel({ onClose }: DrawingsPanelProps) {
  const [selected, setSelected] = useState<string | null>(null)

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

        {/* Section label */}
        <div className="px-4 pt-3 pb-1">
          <span className="text-[10px] font-bold text-[#8b8f9a] tracking-widest">DESENHOS</span>
        </div>

        {/* Tools list */}
        <div className="flex-1 overflow-y-auto">
          {DRAWING_TOOLS.map((tool) => (
            <button
              key={tool.label}
              onClick={() => setSelected(tool.label)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors group',
                selected === tool.label
                  ? 'bg-blue-600/20 text-white'
                  : 'text-white hover:bg-white/5'
              )}
            >
              <div className="flex items-center gap-2">
                {tool.dot && (
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tool.dot }} />
                )}
                <span className="text-[13px] font-medium leading-tight">{tool.label}</span>
              </div>
              <ChevronRight size={13} className="text-[#8b8f9a] group-hover:text-white transition-colors flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
