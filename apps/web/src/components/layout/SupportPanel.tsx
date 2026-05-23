'use client'

import { X, MessageSquare } from 'lucide-react'

interface SupportPanelProps {
  onClose:   () => void
  onCreate?: () => void
}

export function SupportPanel({ onClose, onCreate }: SupportPanelProps) {
  return (
    <div className="flex flex-col bg-[#1a1e2e] border-r border-[#2a2e3b] flex-shrink-0" style={{ width: 320 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e3b]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/20">
            <MessageSquare size={16} className="text-white" />
          </div>
          <h2 className="text-base font-bold text-white">Suporte</h2>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Empty state — centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#252a3a] border border-[#2a2e3b] flex items-center justify-center mb-5">
          <MessageSquare size={26} className="text-blue-500" />
        </div>
        <p className="text-[13px] text-[#8b8f9a] leading-relaxed mb-5">
          Nenhum ticket ainda.<br />
          Crie um para falar com o suporte.
        </p>
        <button
          onClick={onCreate}
          className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-white text-sm font-bold shadow-md shadow-blue-600/20"
        >
          Criar ticket
        </button>
      </div>
    </div>
  )
}
