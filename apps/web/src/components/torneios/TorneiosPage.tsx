'use client'

import { useState } from 'react'
import { Clock, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

type TorneioTab = 'ativo' | 'concluido'

const TORNEIOS = [
  {
    id: 1,
    nome: 'Crazy Wednesday',
    premio: '7500 $',
    taxaEntrada: '10 $',
    duracao: '1 dia',
    status: 'active',
    badge: 'ATIVO AGORA',
  },
  {
    id: 2,
    nome: 'Free Friday',
    premio: '1000 $',
    taxaEntrada: '0 $',
    duracao: '1 dia',
    status: 'soon',
    daysUntil: 1,
    badge: 'ATÉ O INÍCIO: 1 DAY(S)',
  },
  {
    id: 3,
    nome: 'Weekend Battle',
    premio: '5000 $',
    taxaEntrada: '1 $',
    duracao: '2 dias',
    status: 'soon',
    daysUntil: 2,
    badge: 'ATÉ O INÍCIO: 2 DAY(S)',
  },
  {
    id: 4,
    nome: 'Crazy Wednesday',
    premio: '7500 $',
    taxaEntrada: '10 $',
    duracao: '1 dia',
    status: 'soon',
    daysUntil: 6,
    badge: 'ATÉ O INÍCIO: 6 DAY(S)',
  },
]

const TORNEIOS_CONCLUIDOS = [
  { id: 5, nome: 'Crazy Wednesday', premio: '7500 $', taxaEntrada: '10 $', duracao: '1 dia' },
  { id: 6, nome: 'Free Friday',     premio: '1000 $', taxaEntrada: '0 $',  duracao: '1 dia' },
  { id: 7, nome: 'Weekend Battle',  premio: '5000 $', taxaEntrada: '1 $',  duracao: '2 dias' },
]

function CardPattern() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.04] pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" fill="white" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots)" />
    </svg>
  )
}

function TorneioBadge({ torneio }: { torneio: typeof TORNEIOS[0] }) {
  if (torneio.status === 'active') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-blue-500 text-[10px] font-bold text-white tracking-wide">
        ATIVO AGORA
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/20 border border-blue-500/40 text-[10px] font-bold text-blue-300 tracking-wide">
      <Clock size={10} />
      {torneio.badge}
    </span>
  )
}

function TorneioCard({ torneio }: { torneio: typeof TORNEIOS[0] }) {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#1e2235] border border-[#2a2e3b] flex flex-col">
      <CardPattern />

      {/* Top content */}
      <div className="relative px-6 pt-5 pb-4 flex-1">
        {/* Badge */}
        <div className="mb-4">
          <TorneioBadge torneio={torneio} />
        </div>

        {/* Title + Prize */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <h3 className="text-xl font-bold text-white leading-tight">{torneio.nome}</h3>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] font-semibold text-[#8b8f9a] tracking-widest mb-1">RESERVA DE PRÊMIOS</div>
            <div className="text-2xl font-bold text-green-400">{torneio.premio}</div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-10">
          <div>
            <div className="text-lg font-bold text-white">{torneio.taxaEntrada}</div>
            <div className="text-xs text-[#8b8f9a] mt-0.5">Taxa de entrada</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">{torneio.duracao}</div>
            <div className="text-xs text-[#8b8f9a] mt-0.5">Duração</div>
          </div>
        </div>
      </div>

      {/* Details button */}
      <button className="relative w-full flex items-center justify-center gap-2 py-3.5 bg-[#252a3a] hover:bg-[#2e3448] transition-colors border-t border-[#2a2e3b]">
        <span className="text-sm font-semibold text-white">Detalhes</span>
        <div className="w-5 h-5 rounded-full border border-[#8b8f9a] flex items-center justify-center">
          <Info size={11} className="text-[#8b8f9a]" />
        </div>
      </button>
    </div>
  )
}

function TorneioCardConcluido({ torneio }: { torneio: typeof TORNEIOS_CONCLUIDOS[0] }) {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#1a1e2e] border border-[#2a2e3b] opacity-70 flex flex-col">
      <CardPattern />
      <div className="relative px-6 pt-5 pb-4 flex-1">
        <div className="mb-4">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#3a3f50] text-[10px] font-bold text-[#8b8f9a] tracking-wide">
            CONCLUÍDO
          </span>
        </div>
        <div className="flex items-start justify-between gap-4 mb-6">
          <h3 className="text-xl font-bold text-white leading-tight">{torneio.nome}</h3>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] font-semibold text-[#8b8f9a] tracking-widest mb-1">RESERVA DE PRÊMIOS</div>
            <div className="text-2xl font-bold text-[#8b8f9a]">{torneio.premio}</div>
          </div>
        </div>
        <div className="flex items-center gap-10">
          <div>
            <div className="text-lg font-bold text-white">{torneio.taxaEntrada}</div>
            <div className="text-xs text-[#8b8f9a] mt-0.5">Taxa de entrada</div>
          </div>
          <div>
            <div className="text-lg font-bold text-white">{torneio.duracao}</div>
            <div className="text-xs text-[#8b8f9a] mt-0.5">Duração</div>
          </div>
        </div>
      </div>
      <button className="relative w-full flex items-center justify-center gap-2 py-3.5 bg-[#1e2235] hover:bg-[#252a3a] transition-colors border-t border-[#2a2e3b]">
        <span className="text-sm font-semibold text-[#8b8f9a]">Detalhes</span>
        <div className="w-5 h-5 rounded-full border border-[#3a3f50] flex items-center justify-center">
          <Info size={11} className="text-[#3a3f50]" />
        </div>
      </button>
    </div>
  )
}

export function TorneiosPage() {
  const [tab, setTab] = useState<TorneioTab>('ativo')

  return (
    <div className="flex-1 flex flex-col bg-[#151822] min-h-0 overflow-hidden">

      {/* Header */}
      <div className="px-8 pt-6 pb-0 flex-shrink-0">
        <h1 className="text-lg font-bold text-white mb-4">Torneios</h1>

        {/* Tabs */}
        <div className="flex items-center gap-8 border-b border-[#2a2e3b]">
          <button
            onClick={() => setTab('ativo')}
            className={cn(
              'flex items-center gap-2 pb-3 text-sm font-bold tracking-wide border-b-2 -mb-px transition-colors',
              tab === 'ativo' ? 'text-blue-400 border-blue-400' : 'text-[#8b8f9a] border-transparent hover:text-white'
            )}
          >
            ATIVO
            <span className="w-5 h-5 rounded-full bg-blue-500 text-[10px] font-bold text-white flex items-center justify-center">
              {TORNEIOS.length}
            </span>
          </button>
          <button
            onClick={() => setTab('concluido')}
            className={cn(
              'pb-3 text-sm font-bold tracking-wide border-b-2 -mb-px transition-colors',
              tab === 'concluido' ? 'text-blue-400 border-blue-400' : 'text-[#8b8f9a] border-transparent hover:text-white'
            )}
          >
            CONCLUÍDO
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">

        {tab === 'ativo' && (
          <>
            {/* Section title */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 h-px bg-[#2a2e3b]" />
              <span className="text-sm font-semibold text-white whitespace-nowrap">
                Disponível para participação ({TORNEIOS.length})
              </span>
              <div className="flex-1 h-px bg-[#2a2e3b]" />
            </div>

            {/* 2-column grid */}
            <div className="grid grid-cols-2 gap-4">
              {TORNEIOS.map((t) => (
                <TorneioCard key={t.id} torneio={t} />
              ))}
            </div>
          </>
        )}

        {tab === 'concluido' && (
          <>
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 h-px bg-[#2a2e3b]" />
              <span className="text-sm font-semibold text-white whitespace-nowrap">
                Torneios concluídos ({TORNEIOS_CONCLUIDOS.length})
              </span>
              <div className="flex-1 h-px bg-[#2a2e3b]" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {TORNEIOS_CONCLUIDOS.map((t) => (
                <TorneioCardConcluido key={t.id} torneio={t} />
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
