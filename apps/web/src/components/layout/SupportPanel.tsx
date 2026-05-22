'use client'

import { X, Grid2x2, GraduationCap, Headphones, HelpCircle } from 'lucide-react'

interface SupportPanelProps {
  onClose: () => void
}

const SUPPORT_ITEMS = [
  {
    icon: <Grid2x2 size={32} className="text-blue-400" />,
    title: 'Perguntas frequentes',
    subtitle: 'Abrir a base de conhecimento',
  },
  {
    icon: <GraduationCap size={32} className="text-blue-400" />,
    title: 'Tutorials',
    subtitle: 'Use as dicas',
  },
  {
    icon: <Headphones size={32} className="text-blue-400" />,
    title: 'Suporte',
    subtitle: 'Pergunte a um especialista',
  },
]

export function SupportPanel({ onClose }: SupportPanelProps) {
  return (
    <div className="flex flex-col bg-[#1a1e2e] border-r border-[#2a2e3b] flex-shrink-0"
      style={{ width: 240 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
        <h2 className="text-base font-bold text-white">Ajuda</h2>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Support items */}
      <div className="flex flex-col gap-1 p-3 flex-1">
        {SUPPORT_ITEMS.map((item) => (
          <button
            key={item.title}
            className="flex flex-col items-center justify-center gap-2 py-6 px-4 rounded-xl hover:bg-white/5 transition-colors text-center group"
          >
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
              {item.icon}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{item.title}</div>
              <div className="text-xs text-[#8b8f9a] mt-0.5">{item.subtitle}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-5 border-t border-[#2a2e3b] flex flex-col items-center gap-2 text-center">
        <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
          <HelpCircle size={20} className="text-red-400" />
        </div>
        <p className="text-xs text-[#8b8f9a] leading-snug">
          Não encontrou uma resposta para sua pergunta?
        </p>
        <button className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors">
          Contatar o suporte
        </button>
      </div>
    </div>
  )
}
