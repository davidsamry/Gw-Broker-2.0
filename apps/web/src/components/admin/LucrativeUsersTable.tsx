'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

export interface LucrativeUserRow {
  id:            string
  name:          string
  email:         string
  deposited:     number
  profit:        number
  netProfit:     number
  liquidityMode: boolean
}

interface Props {
  rows:  LucrativeUserRow[]
  total: number  // backend total (for the header badge), may exceed rows.length once paginated
}

const PAGE_SIZE = 10

// Reusable component: ranked table of users whose trade winnings exceeded
// their deposits. Includes client-side search + pagination. Markets toggles
// are visual stubs for now (no admin write yet).
export function LucrativeUsersTable({ rows, total }: Props) {
  const [search, setSearch] = useState('')
  const [page,   setPage]   = useState(1)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
    )
  }, [rows, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-400" />
            <h2 className="text-sm font-bold text-white">Usuários Lucrativos</h2>
            <span className="px-2 py-0.5 rounded-full bg-[#1a1e2a] border border-[#1f232e] text-[10px] font-bold text-white">
              {total}
            </span>
          </div>
          <p className="text-xs text-[#8b8f9a] mt-1">Usuários que estão lucrando mais do que depositaram</p>
        </div>

        <div className="relative w-full md:w-72">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Buscar usuário..."
            className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-8 pr-3 text-xs text-white placeholder-[#8b8f9a] outline-none focus:border-emerald-500/50"
          />
        </div>
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-[#8b8f9a]">
          Nenhum usuário lucrativo no momento.
        </div>
      ) : (
        <>
          {/* Header (desktop) */}
          <div className="hidden md:grid grid-cols-[40px_1fr_120px_120px_120px_280px] gap-3 pb-2 border-b border-[#1f232e] text-[10px] font-medium text-[#8b8f9a]">
            <span>#</span>
            <span>Usuário</span>
            <span className="text-right">Depositado</span>
            <span className="text-right">Lucro Total</span>
            <span className="text-right">Lucro Líquido</span>
            <span className="text-right">Mercados</span>
          </div>

          {/* Rows */}
          {pageRows.map((row, idx) => {
            const rank = (page - 1) * PAGE_SIZE + idx + 1
            return (
              <div
                key={row.id}
                className="grid grid-cols-1 md:grid-cols-[40px_1fr_120px_120px_120px_280px] gap-3 py-3 border-b border-[#1f232e]/60 items-center hover:bg-white/[0.02] transition-colors"
              >
                <RankBadge rank={rank} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{row.name || '—'}</div>
                  <div className="text-[10px] text-[#8b8f9a] truncate md:hidden">{row.email}</div>
                </div>
                <div className="text-xs md:text-sm text-white text-right">R$ {formatBRL(row.deposited)}</div>
                <div className="text-xs md:text-sm text-emerald-400 text-right font-semibold">R$ {formatBRL(row.profit)}</div>
                <div className="flex justify-end">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-[11px] font-bold text-emerald-400 whitespace-nowrap">
                    +R$ {formatBRL(row.netProfit)}
                  </span>
                </div>
                {/* Liquidez (funcional) + OTC/Crypto (visual stubs). 2026-06-01:
                    "Forex" foi removido (cTrader off, mercado nao existe mais).
                    Lugar reaproveitado pelo toggle Liquidez que aciona o motor
                    de liquidez forcada do user (User.liquidityMode no banco). */}
                <div className="flex items-center justify-end gap-4 text-[10px] whitespace-nowrap">
                  <LiquidityToggle userId={row.id} initial={row.liquidityMode} />
                  <MarketToggle label="OTC"    on={true}  />
                  <MarketToggle label="Crypto" on={false} />
                </div>
              </div>
            )
          })}

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-xs text-[#8b8f9a]">
            <span>Mostrando {Math.min(filtered.length, PAGE_SIZE)} de {filtered.length} usuários</span>
            <div className="flex items-center gap-1">
              <PagerBtn disabled={page === 1}          onClick={() => setPage(1)}             ><ChevronsLeft  size={14} /></PagerBtn>
              <PagerBtn disabled={page === 1}          onClick={() => setPage((p) => p - 1)}  ><ChevronLeft   size={14} /></PagerBtn>
              <span className="px-2">{page} / {totalPages}</span>
              <PagerBtn disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}  ><ChevronRight  size={14} /></PagerBtn>
              <PagerBtn disabled={page === totalPages} onClick={() => setPage(totalPages)}    ><ChevronsRight size={14} /></PagerBtn>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank === 1 ? 'bg-yellow-500/90 text-black border-yellow-300' :
    rank === 2 ? 'bg-gray-400/80 text-black border-gray-300' :
    rank === 3 ? 'bg-amber-700/80 text-white border-amber-600' :
    'bg-[#1a1e2a] text-[#8b8f9a] border-[#1f232e]'
  return (
    <span className={cn('w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-bold', tone)}>
      {rank}
    </span>
  )
}

// Toggle inline pro modo Liquidez do user. Chama PATCH /admin/users/:id
// com { liquidityMode } e mantem o estado otimisticamente. Se a request
// falha, reverte. Loading state desabilita o click pra evitar double-fire.
function LiquidityToggle({ userId, initial }: { userId: string; initial: boolean }) {
  const [on, setOn]       = useState(initial)
  const [busy, setBusy]   = useState(false)

  async function toggle() {
    if (busy) return
    const next = !on
    setBusy(true)
    setOn(next)  // otimista
    try {
      await api.patch(`/admin/users/${userId}`, { liquidityMode: next })
    } catch {
      setOn(!next)  // reverte
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="flex items-center gap-1.5 disabled:opacity-50"
      title={on ? 'Liquidez ATIVA — proximas ops desse user passam pelo motor' : 'Ativar liquidez forcada'}
    >
      <span className={cn('text-[10px]', on ? 'text-emerald-400 font-semibold' : 'text-[#8b8f9a]')}>
        Liquidez
      </span>
      <span className={cn(
        'relative w-7 h-3.5 rounded-full transition-colors',
        on ? 'bg-emerald-500' : 'bg-[#1f232e]'
      )}>
        <span className={cn(
          'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform',
          on ? 'translate-x-3.5' : 'translate-x-0.5'
        )} />
      </span>
    </button>
  )
}

function MarketToggle({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[#8b8f9a]">{label}</span>
      <span className={cn(
        'relative w-7 h-3.5 rounded-full transition-colors',
        on ? 'bg-emerald-500' : 'bg-[#1f232e]'
      )}>
        <span className={cn(
          'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform',
          on ? 'translate-x-3.5' : 'translate-x-0.5'
        )} />
      </span>
    </div>
  )
}

function PagerBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="w-7 h-7 flex items-center justify-center rounded border border-[#1f232e] text-[#8b8f9a] hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
