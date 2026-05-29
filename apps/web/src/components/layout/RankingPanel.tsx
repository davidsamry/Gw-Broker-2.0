'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, ChevronDown, Trophy, Globe } from 'lucide-react'
import { api } from '@/lib/api'
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
  // True when this entry is the currently logged-in user. The merge step
  // below injects the user into the fictional pool, re-sorts by amount
  // and re-ranks 1..N so the user appears in the position their winnings
  // actually deserve (was previously a separate card on top — leaving
  // the leaderboard with Bruno C. as #1 even when the user had more).
  isMe?:  boolean
}

// Cache (sessionStorage) — the public ranking is identical for ALL users
// during a 3h window, so we cache the response locally and only refetch
// when the cached `rotatesAt` ISO has passed. Saves a roundtrip on every
// reopen of the panel.
const RANKING_CACHE_KEY = 'vx_ranking_cache_v1'
interface CachedRanking { entries: LeaderEntry[]; rotatesAt: string }

function loadCachedRanking(): CachedRanking | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(RANKING_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedRanking
    if (new Date(parsed.rotatesAt).getTime() <= Date.now()) return null   // expired
    return parsed
  } catch { return null }
}
function saveCachedRanking(c: CachedRanking): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(RANKING_CACHE_KEY, JSON.stringify(c)) } catch { /* private mode */ }
}

const REGION_LABEL: Record<Region, string> = {
  MUNDIAL:  'Mundialmente',
  BRASIL:   'Brasil',
  AMERICAS: 'Américas',
  EUROPA:   'Europa',
}

export function RankingPanel({ onClose, userName = 'Você', userCode = 'br' }: RankingPanelProps) {
  const [region, setRegion]         = useState<Region>('MUNDIAL')
  const [regionOpen, setRegionOpen] = useState(false)
  // Seed from cache so the list paints instantly on reopen. Refetch in
  // background to pick up admin edits + new 3h rotations.
  const cached = typeof window !== 'undefined' ? loadCachedRanking() : null
  const [leaders, setLeaders]       = useState<LeaderEntry[]>(cached?.entries ?? [])
  const [rotatesAt, setRotatesAt]   = useState<string | null>(cached?.rotatesAt ?? null)
  // User's own weekly winnings + relative position. Null until the
  // /ranking/me request lands (or the user isn't authenticated).
  const [myStats, setMyStats] = useState<{ amount: number; position: number | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    // Fire both in parallel — the public leaderboard works without auth,
    // /ranking/me requires it. Either failure is silent (panel falls back
    // to cached / "—" state).
    api.get<{ entries: LeaderEntry[]; rotatesAt: string }>('/ranking')
      .then(({ data }) => {
        if (cancelled) return
        setLeaders(data.entries)
        setRotatesAt(data.rotatesAt)
        saveCachedRanking({ entries: data.entries, rotatesAt: data.rotatesAt })
      })
      .catch(() => { /* keep cached/empty — silent */ })
    api.get<{ amount: number; position: number | null }>('/ranking/me')
      .then(({ data }) => { if (!cancelled) setMyStats(data) })
      .catch(() => { /* not logged in or backend down — leave myStats null */ })
    return () => { cancelled = true }
  }, [])

  // Inject the logged-in user into the leaderboard at the right rank.
  // We treat the fictional pool + the user as one combined list, sort by
  // amount DESC, take the top 25, then renumber 1..N. This way the user
  // organically lands at #1 when their winnings beat every fictional
  // entry — or somewhere in the middle/bottom otherwise. If the user
  // has zero winnings (myStats.amount === 0) or isn't logged in
  // (myStats === null), we render the pool unchanged.
  const mergedLeaders = useMemo<LeaderEntry[]>(() => {
    if (!myStats || myStats.amount <= 0) return leaders
    const me: LeaderEntry = {
      rank:   0, // re-numbered below
      name:   userName ?? 'Você',
      code:   userCode ?? 'br',
      amount: myStats.amount,
      isMe:   true,
    }
    // Stable sort: when amount ties, fictional entries keep their
    // relative order (Array.prototype.sort in V8 is stable since 2018).
    const combined = [me, ...leaders]
    combined.sort((a, b) => b.amount - a.amount)
    return combined
      .slice(0, leaders.length || 25)
      .map((e, i) => ({ ...e, rank: i + 1 }))
  }, [leaders, myStats, userName, userCode])

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

      {/* User own row — values come from /ranking/me (winnings on REAL
          account this week + relative position in current leaderboard).
          Falls back to "—" / "R$ 0,00" while loading or when no profit. */}
      <div className="px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#252a3a]/60 border border-[#2a2e3b]">
          <span className="text-[#8b8f9a] text-sm font-bold w-4 text-center">
            {myStats?.position ?? '—'}
          </span>
          <Flag code={userCode} size={20} />
          <span className="flex-1 text-sm font-semibold text-white truncate">{userName}</span>
          <span className={cn(
            'text-sm font-bold whitespace-nowrap',
            (myStats?.amount ?? 0) > 0 ? 'text-green-400' : 'text-white',
          )}>
            R$ {(myStats?.amount ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        {(!myStats || myStats.amount === 0) && (
          <p className="text-[11px] text-[#8b8f9a] mt-2 px-1 leading-relaxed">
            Você ainda não teve nenhuma negociação lucrativa nesta semana
          </p>
        )}
      </div>

      {/* Leaderboard — merged: fictional pool + logged-in user inserted
          in the position their REAL winnings put them in. */}
      <div className="flex-1 overflow-y-auto">
        {mergedLeaders.length === 0 ? (
          <div className="text-center text-[#8b8f9a] text-xs py-12 px-4">
            Sem dados de ranking no momento.
          </div>
        ) : (
          mergedLeaders.map((entry) => (
            <LeaderRow key={`${entry.rank}-${entry.isMe ? 'me' : entry.name}`} entry={entry} />
          ))
        )}
      </div>

      {/* Rotation hint (optional debug — only in dev) */}
      {process.env.NODE_ENV !== 'production' && rotatesAt && (
        <div className="px-4 pb-2 text-[10px] text-[#8b8f9a] text-center">
          Próxima rotação: {new Date(rotatesAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}

function LeaderRow({ entry }: { entry: LeaderEntry }) {
  const isTop3 = entry.rank <= 3
  return (
    <div className={cn(
      'px-4 py-2.5 flex items-center gap-3 border-b border-[#2a2e3b]/40 transition-colors',
      // Tinted row + left accent when the entry is the logged-in user,
      // so the admin/trader can spot their own line at a glance even if
      // they're in the middle of the list.
      entry.isMe
        ? 'bg-blue-500/10 border-l-2 border-l-blue-400 hover:bg-blue-500/15'
        : 'hover:bg-white/[0.02]',
    )}>
      <RankBadge rank={entry.rank} />
      <Flag code={entry.code} size={20} />
      <span className={cn(
        'flex-1 text-sm font-medium truncate',
        entry.isMe ? 'text-blue-200' : 'text-white',
      )}>
        {entry.name}{entry.isMe && ' (Você)'}
      </span>
      <span className={cn(
        'text-sm font-bold whitespace-nowrap',
        entry.isMe ? 'text-blue-300' : isTop3 ? 'text-green-400' : 'text-white',
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
