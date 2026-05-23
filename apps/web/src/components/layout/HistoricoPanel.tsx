'use client'

import { useEffect, useState } from 'react'
import { X, ChevronDown, ArrowUp, ArrowDown, Package } from 'lucide-react'
import { api } from '@/lib/api'
import { ASSETS } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { FlagPair } from '@/components/ui/FlagPair'

interface HistoricoPanelProps {
  onClose: () => void
  isDemo: boolean
}

type Filter = 'FINALIZADAS' | 'PENDENTES' | 'TODAS'

interface ApiOperation {
  id:          string
  assetId:     string
  assetSymbol: string
  direction:   'CALL' | 'PUT'
  amount:      string
  payout:      number
  profit:      string | null
  status:      'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  expiresAt:   string
  openedAt:    string
  closedAt:    string | null
}

interface Item {
  id:        string
  date:      string  // "22 Mai"
  time:      string  // "23:36"
  symbol:    string
  code1:     string
  code2:     string
  direction: 'CALL' | 'PUT'
  amount:    number
  status:    'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  profit:    number  // R$
  payout:    number  // %
}

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function toItem(op: ApiOperation): Item {
  const dt = new Date(op.closedAt ?? op.expiresAt ?? op.openedAt)
  const time = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const date = `${dt.getDate().toString().padStart(2, '0')} ${MONTHS_PT[dt.getMonth()]}`
  // Look up asset in catalog to use the short symbol (e.g. "BTC/USDT") and
  // accurate flag codes — same name shown in the header asset tabs.
  const asset = ASSETS.find((a) => a.id === op.assetId)
  const parts = op.assetId.split('-')
  return {
    id:        op.id,
    date,
    time,
    symbol:    asset?.symbol ?? op.assetSymbol,
    code1:     asset?.code1 ?? parts[0] ?? '',
    code2:     asset?.code2 ?? parts[1] ?? '',
    direction: op.direction,
    amount:    Number(op.amount),
    status:    op.status,
    profit:    Number(op.profit ?? 0),
    payout:    op.payout,
  }
}

export function HistoricoPanel({ onClose, isDemo }: HistoricoPanelProps) {
  const [filter, setFilter]       = useState<Filter>('FINALIZADAS')
  const [filterOpen, setFilterOpen] = useState(false)
  const [ops, setOps]             = useState<Item[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get('/operations').then(({ data }) => {
      if (cancelled) return
      const items = (data?.operations ?? []).map(toItem) as Item[]
      setOps(items)
    }).catch(() => { /* silent */ }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    // Refresh every 5s so pending ones update + new resolutions appear
    const tick = setInterval(() => {
      api.get('/operations').then(({ data }) => {
        if (cancelled) return
        setOps((data?.operations ?? []).map(toItem))
      }).catch(() => {})
    }, 5000)
    return () => { cancelled = true; clearInterval(tick) }
  }, [])

  const filtered = ops.filter((o) => {
    if (filter === 'PENDENTES')   return o.status === 'OPEN'
    if (filter === 'FINALIZADAS') return o.status === 'WON' || o.status === 'LOST'
    return true
  })

  return (
    <div className="flex flex-col bg-[#1a1e2e] border-r border-[#2a2e3b] flex-shrink-0" style={{ width: 280 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
        <h2 className="text-base font-bold text-white">Histórico Trading</h2>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Filter dropdown */}
      <div className="px-4 pt-3 pb-2 relative">
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-[#252a3a] border border-[#2a2e3b] hover:border-blue-500/40 transition-colors"
        >
          <span className="text-sm font-medium text-white capitalize">{filter.toLowerCase()}</span>
          <ChevronDown size={14} className={cn('text-[#8b8f9a] transition-transform', filterOpen && 'rotate-180')} />
        </button>
        {filterOpen && (
          <div className="absolute top-full left-4 right-4 mt-1 bg-[#252a3a] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-20">
            {(['FINALIZADAS', 'PENDENTES', 'TODAS'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setFilterOpen(false) }}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm capitalize transition-colors',
                  f === filter ? 'bg-blue-500/15 text-blue-300' : 'text-white hover:bg-white/5'
                )}
              >
                {f.toLowerCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Account label */}
      <div className="px-4 pb-2">
        <span className="text-[10px] font-bold text-blue-400 tracking-widest">
          {isDemo ? 'CONTA DE PRÁTICA' : 'CONTA REAL'}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-6 py-12 text-center text-[#8b8f9a] text-xs">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-[#252a3a] flex items-center justify-center mb-3">
              <Package size={20} className="text-[#8b8f9a]" />
            </div>
            <p className="text-[12px] text-[#8b8f9a]">Nenhuma operação por aqui ainda.</p>
          </div>
        ) : (
          filtered.map((op) => <HistoricoItem key={op.id} item={op} />)
        )}
      </div>
    </div>
  )
}

function HistoricoItem({ item }: { item: Item }) {
  const won  = item.status === 'WON'
  const lost = item.status === 'LOST'
  // Profit display: won -> +profit, lost -> -amount, pending -> 0
  const net = won ? item.profit : lost ? -item.amount : 0
  // Percentage: won -> +payout%, lost -> -100%, pending -> 0%
  const pct = won ? `+${item.payout}%` : lost ? '-100%' : '0%'
  const sign = net > 0 ? '+' : net < 0 ? '' : ''
  const netColor = won ? 'text-green-400' : lost ? 'text-red-400' : 'text-[#8b8f9a]'

  // FlagPair handles both ISO country codes ('us') and crypto codes ('crypto:btc')
  const hasFlags = Boolean(item.code1 && item.code2)

  return (
    <div className="px-3 mb-px">
      <div className="px-2 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
        <div className="flex items-center gap-2">
          {/* Date + time */}
          <div className="flex flex-col items-start min-w-[42px]">
            <span className="text-[12px] font-bold text-white leading-tight">{item.time}</span>
            <span className="text-[10px] text-[#8b8f9a] leading-tight">{item.date}</span>
          </div>

          {/* Asset icon */}
          <div className="flex-shrink-0">
            {hasFlags
              ? <FlagPair code1={item.code1} code2={item.code2} size={18} />
              : <div className="w-[26px] h-[26px] rounded-full bg-gradient-to-br from-[#f7931a] to-[#ffb84d] flex items-center justify-center text-white text-[11px] font-black">
                  {item.symbol[0]}
                </div>
            }
          </div>

          {/* Symbol */}
          <span className="flex-1 text-[12px] font-semibold text-white whitespace-nowrap">
            {item.symbol}
          </span>

          {/* Right block: direction + profit */}
          <div className="flex flex-col items-end flex-shrink-0">
            <div className="flex items-center gap-1">
              {item.direction === 'CALL'
                ? <ArrowUp size={10} strokeWidth={3} className="text-green-400" />
                : <ArrowDown size={10} strokeWidth={3} className="text-red-400" />}
              <span className="text-[11px] font-bold text-white">R$ {item.amount.toFixed(2).replace('.', ',')}</span>
            </div>
            <span className={cn('text-[10px] font-bold mt-0.5', netColor)}>
              {sign}R$ {Math.abs(net).toFixed(2).replace('.', ',')} ({pct})
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
