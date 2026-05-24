'use client'

import { useState } from 'react'
import { X, ChevronDown, Trophy, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RankingPanelProps {
  onClose:   () => void
  userName?: string
  userCode?: string  // ISO 2-letter for user's flag
}

type Region = 'MUNDIAL' | 'BRASIL' | 'AMERICAS' | 'EUROPA'

interface LeaderEntry {
  rank:   number
  name:   string
  code:   string  // ISO 2-letter
  amount: number  // R$
}

// Top of the leaderboard — mock weekly data so the page is full and looks live.
const LEADERS: LeaderEntry[] = [
  { rank:  1, name: 'Apollo I.',     code: 'br', amount: 91590.80 },
  { rank:  2, name: 'Yonathan D.',   code: 'id', amount: 39531.14 },
  { rank:  3, name: 'Joseph R.',     code: 'kr', amount: 39069.49 },
  { rank:  4, name: 'Felipe A.',     code: 'ng', amount: 38544.89 },
  { rank:  5, name: 'Mariana X.',    code: 'us', amount: 38456.75 },
  { rank:  6, name: 'Valci L.',      code: 'pt', amount: 37887.26 },
  { rank:  7, name: 'Pedro B.',      code: 'kr', amount: 37800.08 },
  { rank:  8, name: 'Daniel O.',     code: 'id', amount: 37290.47 },
  { rank:  9, name: 'Isabela G.',    code: 'us', amount: 37049.92 },
  { rank: 10, name: 'Kanwara S.',    code: 'pe', amount: 36849.53 },
  { rank: 11, name: 'Diego B.',      code: 'jp', amount: 36703.25 },
  { rank: 12, name: 'Angelo H.',     code: 'br', amount: 36540.96 },
  { rank: 13, name: 'Leonardo U.',   code: 'bo', amount: 36417.43 },
  { rank: 14, name: 'Vinicius A.',   code: 'br', amount: 36351.49 },
  { rank: 15, name: 'Leo V.',        code: 'de', amount: 36291.68 },
  { rank: 16, name: 'Julia J.',      code: 'us', amount: 36162.91 },
  { rank: 17, name: 'Ricardo P.',    code: 'br', amount: 36041.10 },
  { rank: 18, name: 'Sofia T.',      code: 'ar', amount: 35987.55 },
  { rank: 19, name: 'Hans M.',       code: 'de', amount: 35804.21 },
  { rank: 20, name: 'Yuki N.',       code: 'jp', amount: 35692.83 },
  { rank: 21, name: 'Carlos R.',     code: 'mx', amount: 35501.16 },
  { rank: 22, name: 'Anna K.',       code: 'ru', amount: 35349.90 },
  { rank: 23, name: 'Bruno C.',      code: 'pt', amount: 35178.42 },
  { rank: 24, name: 'Priya S.',      code: 'in', amount: 35044.61 },
  { rank: 25, name: 'Olivia W.',     code: 'gb', amount: 34902.18 },
]

const REGION_LABEL: Record<Region, string> = {
  MUNDIAL:  'Mundialmente',
  BRASIL:   'Brasil',
  AMERICAS: 'Américas',
  EUROPA:   'Europa',
}

export function RankingPanel({ onClose, userName = 'Você', userCode = 'br' }: RankingPanelProps) {
  const [region, setRegion]         = useState<Region>('MUNDIAL')
  const [regionOpen, setRegionOpen] = useState(false)

  return (
    // Width: 320px on desktop (side panel beside chart). Full width + height
    // on mobile, where page.tsx renders this as the sole content of RANKING.
    <div className="flex flex-col bg-[#1a1e2e] md:border-r border-[#2a2e3b] flex-shrink-0 w-full h-full md:w-[320px]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-yellow-400" />
          <h2 className="text-base font-bold text-white">Líderes da semana</h2>
          <Trophy size={14} className="text-yellow-400/60" />
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Region selector */}
      <div className="px-4 pt-3 pb-2 relative">
        <button
          onClick={() => setRegionOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-[#252a3a] border border-[#2a2e3b] hover:border-blue-500/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Globe size={14} className="text-[#8b8f9a]" />
            <span className="text-sm font-medium text-white">{REGION_LABEL[region]}</span>
          </span>
          <ChevronDown size={14} className={cn('text-[#8b8f9a] transition-transform', regionOpen && 'rotate-180')} />
        </button>
        {regionOpen && (
          <div className="absolute top-full left-4 right-4 mt-1 bg-[#252a3a] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-20">
            {(Object.keys(REGION_LABEL) as Region[]).map((r) => (
              <button
                key={r}
                onClick={() => { setRegion(r); setRegionOpen(false) }}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm transition-colors',
                  r === region ? 'bg-blue-500/15 text-blue-300' : 'text-white hover:bg-white/5'
                )}
              >
                {REGION_LABEL[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User own row + empty-week notice */}
      <div className="px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#252a3a]/60 border border-[#2a2e3b]">
          <span className="text-[#8b8f9a] text-sm font-bold w-4 text-center">—</span>
          <Flag code={userCode} size={20} />
          <span className="flex-1 text-sm font-semibold text-white truncate">{userName}</span>
          <span className="text-sm font-bold text-white">R$ 0,00</span>
        </div>
        <p className="text-[11px] text-[#8b8f9a] mt-2 px-1 leading-relaxed">
          Você ainda não teve nenhuma negociação lucrativa nesta semana
        </p>
      </div>

      {/* Leaderboard */}
      <div className="flex-1 overflow-y-auto">
        {LEADERS.map((entry) => (
          <LeaderRow key={entry.rank} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function LeaderRow({ entry }: { entry: LeaderEntry }) {
  const isTop3 = entry.rank <= 3
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 border-b border-[#2a2e3b]/40 hover:bg-white/[0.02] transition-colors">
      <RankBadge rank={entry.rank} />
      <Flag code={entry.code} size={20} />
      <span className="flex-1 text-sm font-medium text-white truncate">{entry.name}</span>
      <span className={cn(
        'text-sm font-bold whitespace-nowrap',
        isTop3 ? 'text-green-400' : 'text-white'
      )}>
        R$ {entry.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-yellow-300 to-yellow-500 flex items-center justify-center text-[#3a2700] text-[11px] font-black shadow-md shadow-yellow-500/30">
      1
    </div>
  )
  if (rank === 2) return (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-[#1a1e2e] text-[11px] font-black shadow-md shadow-gray-400/20">
      2
    </div>
  )
  if (rank === 3) return (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-[11px] font-black shadow-md shadow-orange-500/30">
      3
    </div>
  )
  return (
    <span className="w-6 text-center text-[12px] font-bold text-[#8b8f9a]">{rank}</span>
  )
}

function Flag({ code, size = 18 }: { code: string; size?: number }) {
  // Loads the country flag from flagcdn (already used in FlagPair).
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={code}
      width={size}
      height={size}
      className="rounded-full object-cover border border-white/10 flex-shrink-0"
      style={{ width: size, height: size }}
    />
  )
}
