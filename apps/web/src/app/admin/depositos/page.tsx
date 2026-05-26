'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownToLine, DollarSign, CheckCircle2, Receipt, RefreshCw, Search,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { KpiCard } from '@/components/admin/KpiCard'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/lib/useDebounce'

interface DepositRow {
  id:         string
  accountId:  string
  userId:     string
  userName:   string
  userEmail:  string
  amount:     string
  bonus:      string | null
  method:     string
  externalId: string | null
  status:     'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
  isFake:     boolean
  notes:      string | null
  createdAt:  string
  paidAt:     string | null
}

interface Counts {
  total:        number
  paid:         number
  pending:      number
  totalAmount:  string
  paidAmount:   string
  ticketAvg:    string
}

interface ListResponse {
  deposits: DepositRow[]
  total:    number
  page:     number
  pageSize: number
  counts:   Counts
}

type StatusFilter = 'ALL' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
const PAGE_SIZE = 25

export default function AdminDepositsPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [search, setSearch] = useState('')
  // 300ms debounce — input stays instant, API only fires after typing pause.
  const debouncedSearch     = useDebounce(search, 300)
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [page, setPage]     = useState(1)

  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: any = { page, pageSize: PAGE_SIZE }
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      if (status !== 'ALL') params.status = status
      const res = await api.get<ListResponse>('/admin/deposits', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar depósitos.')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, status, page])

  useEffect(() => { setPage(1) }, [debouncedSearch, status])
  useEffect(() => { load() }, [load])

  async function markPaid(dep: DepositRow) {
    if (busyId || dep.status !== 'PENDING') return
    const total = parseFloat(dep.amount) + parseFloat(dep.bonus ?? '0')
    if (!confirm(`Confirmar recebimento e creditar R$ ${total.toFixed(2)} para ${dep.userEmail}?`)) return
    setBusyId(dep.id)
    try {
      await api.post(`/admin/deposits/${dep.id}/mark-paid`)
      await load()
    } catch (err: any) {
      if (err?.response?.data?.error === 'DEPOSIT_NOT_PAYABLE') {
        alert('Este depósito não pode mais ser marcado como recebido.')
      } else {
        alert('Erro ao marcar como recebido.')
      }
    } finally {
      setBusyId(null)
    }
  }

  async function toggleFake(dep: DepositRow) {
    if (busyId) return
    setBusyId(dep.id)
    try {
      await api.patch(`/admin/deposits/${dep.id}/fake`, { isFake: !dep.isFake })
      // Optimistic local update
      setData((prev) => prev ? {
        ...prev,
        deposits: prev.deposits.map((d) => d.id === dep.id ? { ...d, isFake: !d.isFake } : d),
      } : prev)
    } catch {
      alert('Erro ao atualizar.')
    } finally {
      setBusyId(null)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const counts = data?.counts

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      {/* Topbar */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ArrowDownToLine size={20} className="text-emerald-400" />
            Gestão de Depósitos
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">Visualize os depósitos dos usuários</p>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#13161f] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <KpiCard
          label="Depósitos Gerados"
          value={String(counts?.total ?? 0)}
          hint={`R$ ${fmtBRL(counts?.totalAmount ?? '0')} total`}
          icon={<Receipt size={14} />}
          tone="bg-blue-500/15 text-blue-400"
        />
        <KpiCard
          label="Depósitos Pagos"
          value={String(counts?.paid ?? 0)}
          hint={`R$ ${fmtBRL(counts?.paidAmount ?? '0')} recebidos`}
          icon={<CheckCircle2 size={14} />}
          tone="bg-emerald-500/15 text-emerald-400"
          valueTone="text-white"
        />
        <KpiCard
          label="Ticket Médio"
          value={`R$ ${fmtBRL(counts?.ticketAvg ?? '0')}`}
          hint="média por depósito"
          icon={<DollarSign size={14} />}
          tone="bg-yellow-500/15 text-yellow-400"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-3">
        <TabBtn active={status === 'ALL'}     onClick={() => setStatus('ALL')}>Todos ({counts?.total ?? 0})</TabBtn>
        <TabBtn active={status === 'PAID'}    onClick={() => setStatus('PAID')}>Pagos ({counts?.paid ?? 0})</TabBtn>
        <TabBtn active={status === 'PENDING'} onClick={() => setStatus('PENDING')}>Pendentes ({counts?.pending ?? 0})</TabBtn>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-8 pr-3 text-xs text-white placeholder-[#8b8f9a] outline-none focus:border-emerald-500/50"
          />
        </div>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead>
              <tr className="border-b border-[#1f232e] text-[10px] text-[#8b8f9a] font-bold uppercase tracking-wide">
                <th className="text-left  px-4 py-3">Nome</th>
                <th className="text-right px-3 py-3">Valor</th>
                <th className="text-right px-3 py-3">Bônus</th>
                <th className="text-left  px-3 py-3">Status</th>
                <th className="text-left  px-3 py-3">Data</th>
                <th className="text-center px-3 py-3">Fake</th>
                <th className="text-center px-3 py-3">Recebido</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-[#8b8f9a]">Carregando…</td></tr>
              ) : data && data.deposits.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-[#8b8f9a]">
                  Nenhum depósito encontrado.
                </td></tr>
              ) : (
                data?.deposits.map((d) => (
                  <tr key={d.id} className="border-b border-[#1f232e]/50 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-white truncate max-w-[260px]">{d.userName || '—'}</div>
                      <div className="text-[10px] text-[#8b8f9a] font-mono">{d.id.slice(0, 10)}…</div>
                    </td>
                    <td className="px-3 py-3 text-right text-white font-medium">R$ {fmtBRL(d.amount)}</td>
                    <td className="px-3 py-3 text-right">
                      {d.bonus && parseFloat(d.bonus) > 0
                        ? <span className="text-emerald-400 font-semibold">+R$ {fmtBRL(d.bonus)}</span>
                        : <span className="text-[#8b8f9a]">—</span>}
                    </td>
                    <td className="px-3 py-3"><StatusChip status={d.status} /></td>
                    <td className="px-3 py-3 text-[#8b8f9a]">{formatDateTime(d.createdAt)}</td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={d.isFake}
                        disabled={busyId === d.id}
                        onChange={() => toggleFake(d)}
                        className="w-4 h-4 accent-orange-500 cursor-pointer disabled:cursor-not-allowed"
                        title="Marcar como depósito fake / teste"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      {d.status === 'PAID' ? (
                        <CheckCircle2 size={16} className="text-emerald-400 mx-auto" />
                      ) : d.status === 'PENDING' ? (
                        <button
                          onClick={() => markPaid(d)}
                          disabled={busyId === d.id}
                          title="Confirmar recebimento (credita saldo + bônus)"
                          className="inline-flex items-center justify-center w-7 h-7 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30 transition-colors"
                        >
                          <CheckCircle2 size={13} />
                        </button>
                      ) : (
                        <span className="text-[#8b8f9a]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.deposits.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 text-xs text-[#8b8f9a] border-t border-[#1f232e]">
            <span>
              Mostrando {(data.page - 1) * data.pageSize + 1}–
              {Math.min(data.page * data.pageSize, data.total)} de {data.total}
            </span>
            <div className="flex items-center gap-1">
              <Pager disabled={page === 1}          onClick={() => setPage(1)}            ><ChevronsLeft  size={14} /></Pager>
              <Pager disabled={page === 1}          onClick={() => setPage((p) => p - 1)} ><ChevronLeft   size={14} /></Pager>
              <span className="px-2 font-semibold text-white">{page} / {totalPages}</span>
              <Pager disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} ><ChevronRight  size={14} /></Pager>
              <Pager disabled={page === totalPages} onClick={() => setPage(totalPages)}   ><ChevronsRight size={14} /></Pager>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
        active
          ? 'bg-[#1a1e2a] text-white border border-[#2a2e3b]'
          : 'text-[#8b8f9a] hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

function StatusChip({ status }: { status: DepositRow['status'] }) {
  const map: Record<DepositRow['status'], { label: string; tone: string }> = {
    PENDING:   { label: 'Pendente',  tone: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/40' },
    PAID:      { label: 'Recebido',  tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
    FAILED:    { label: 'Falhou',    tone: 'bg-red-500/15 text-red-400 border-red-500/40' },
    CANCELLED: { label: 'Cancelado', tone: 'bg-[#1a1e2a] text-[#8b8f9a] border-[#1f232e]' },
  }
  const cfg = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit', cfg.tone)}>
      {cfg.label}
    </span>
  )
}

function Pager({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="w-7 h-7 flex items-center justify-center rounded border border-[#1f232e] text-[#8b8f9a] hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

function fmtBRL(s: string) {
  return (parseFloat(s) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`
}
