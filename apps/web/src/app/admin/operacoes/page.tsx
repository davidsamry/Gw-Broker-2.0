'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity, Search, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUp, ArrowDown, Eye, X, ChevronDown,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface OpRow {
  id:           string
  accountId:    string
  accountType:  'REAL' | 'DEMO'
  userId:       string
  userName:     string
  userEmail:    string
  assetId:      string
  assetSymbol:  string
  marketSymbol: string | null
  direction:    'CALL' | 'PUT'
  amount:       string
  payout:       number
  entryPrice:   string
  exitPrice:    string | null
  profit:       string | null
  status:       'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  expiresAt:    string
  openedAt:     string
  closedAt:     string | null
  timeframeSec: number
}

interface ListResponse {
  operations: OpRow[]
  total:      number
  page:       number
  pageSize:   number
}

type StatusFilter      = 'ALL' | 'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
type AccountTypeFilter = 'ALL' | 'REAL' | 'DEMO'

const PAGE_SIZE = 25

export default function AdminOperationsPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [search, setSearch]           = useState('')
  const [status, setStatus]           = useState<StatusFilter>('ALL')
  const [accountType, setAccountType] = useState<AccountTypeFilter>('ALL')
  const [page, setPage]               = useState(1)
  const [viewing, setViewing]         = useState<OpRow | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page, pageSize: PAGE_SIZE }
      if (search.trim())   params.search      = search.trim()
      if (status !== 'ALL') params.status      = status
      if (accountType !== 'ALL') params.accountType = accountType
      const res = await api.get<ListResponse>('/admin/operations', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar operações.')
    } finally {
      setLoading(false)
    }
  }, [search, status, accountType, page])

  useEffect(() => { setPage(1) }, [search, status, accountType])
  useEffect(() => { load() }, [load])

  async function handleCancel(op: OpRow) {
    if (cancellingId || op.status !== 'OPEN') return
    if (!confirm(`Cancelar a operação ${op.id.slice(0, 8).toUpperCase()} e devolver R$ ${fmtBRL(op.amount)} para ${op.userEmail}?`)) return
    setCancellingId(op.id)
    try {
      await api.post(`/admin/operations/${op.id}/cancel`)
      await load()
    } catch (err: any) {
      if (err?.response?.data?.error === 'OPERATION_NOT_CANCELLABLE') {
        alert('Esta operação não pode mais ser cancelada (já foi resolvida).')
      } else {
        alert('Erro ao cancelar.')
      }
    } finally {
      setCancellingId(null)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      {/* Topbar */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-emerald-400" />
            Operações
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">
            Gerencie as operações de trading dos usuários
          </p>
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

      {/* Filters */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-4 flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar operação (usuário, email, ativo)..."
            className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-8 pr-3 text-xs text-white placeholder-[#8b8f9a] outline-none focus:border-emerald-500/50"
          />
        </div>

        <SelectField label="Status" value={status} onChange={(v) => setStatus(v as StatusFilter)} options={[
          ['ALL', 'Todos'], ['OPEN', 'Aguardando'], ['WON', 'Ganhou'], ['LOST', 'Perdeu'], ['CANCELLED', 'Cancelada'],
        ]} />

        <SelectField label="Carteira" value={accountType} onChange={(v) => setAccountType(v as AccountTypeFilter)} options={[
          ['ALL', 'Todas'], ['REAL', 'Real'], ['DEMO', 'Demo'],
        ]} />
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1200px]">
            <thead>
              <tr className="border-b border-[#1f232e] text-[10px] text-[#8b8f9a] font-bold uppercase tracking-wide">
                <th className="text-left  px-3 py-3">Nome</th>
                <th className="text-left  px-3 py-3">Email</th>
                <th className="text-left  px-3 py-3">Data/Hora</th>
                <th className="text-left  px-3 py-3">Timeframe</th>
                <th className="text-right px-3 py-3">Apostado</th>
                <th className="text-right px-3 py-3">Ganho</th>
                <th className="text-left  px-3 py-3">Carteira</th>
                <th className="text-left  px-3 py-3">Tipo</th>
                <th className="text-left  px-3 py-3">Mercado</th>
                <th className="text-left  px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={11} className="py-12 text-center text-sm text-[#8b8f9a]">Carregando…</td></tr>
              ) : data && data.operations.length === 0 ? (
                <tr><td colSpan={11} className="py-12 text-center text-sm text-[#8b8f9a]">Nenhuma operação encontrada.</td></tr>
              ) : (
                data?.operations.map((op) => {
                  const isUp   = op.direction === 'CALL'
                  const stake  = parseFloat(op.amount)
                  const profit = parseFloat(op.profit ?? '0')
                  const gain   =
                    op.status === 'WON'  ? profit :
                    op.status === 'LOST' ? -stake :
                    null
                  return (
                    <tr key={op.id} className="border-b border-[#1f232e]/50 hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-3 font-semibold text-white">{op.userName || '—'}</td>
                      <td className="px-3 py-3 text-[#8b8f9a] truncate max-w-[220px]">{op.userEmail}</td>
                      <td className="px-3 py-3 text-[#8b8f9a]">{formatDateTime(op.openedAt)}</td>
                      <td className="px-3 py-3 text-white">{formatTimeframe(op.timeframeSec)}</td>
                      <td className="px-3 py-3 text-right text-white">R$ {fmtBRL(op.amount)}</td>
                      <td className={cn('px-3 py-3 text-right font-semibold',
                        gain == null ? 'text-[#8b8f9a]' : gain >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {gain == null ? '—' : `R$ ${gain >= 0 ? '' : '-'}${fmtBRL(Math.abs(gain))}`}
                      </td>
                      <td className="px-3 py-3">
                        <AccountChip type={op.accountType} />
                      </td>
                      <td className="px-3 py-3">
                        <DirectionChip up={isUp} />
                      </td>
                      <td className="px-3 py-3 text-white font-mono text-[11px]">{op.assetSymbol}</td>
                      <td className="px-3 py-3"><StatusChip status={op.status} /></td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <IconBtn title="Ver detalhes" onClick={() => setViewing(op)}>
                            <Eye size={13} />
                          </IconBtn>
                          <IconBtn
                            title={op.status === 'OPEN' ? 'Cancelar e devolver saldo' : 'Apenas operações em aberto podem ser canceladas'}
                            onClick={() => handleCancel(op)}
                            disabled={op.status !== 'OPEN' || cancellingId === op.id}
                            tone="red"
                          >
                            <X size={13} />
                          </IconBtn>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.operations.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 text-xs text-[#8b8f9a] border-t border-[#1f232e]">
            <span>
              Mostrando {(data.page - 1) * data.pageSize + 1}–
              {Math.min(data.page * data.pageSize, data.total)} de {data.total} registros
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

      {viewing && <ViewModal op={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function SelectField({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-3 pr-8 text-xs text-white outline-none focus:border-emerald-500/50 appearance-none cursor-pointer"
      >
        {options.map(([v, lbl]) => (
          <option key={v} value={v}>{label === 'Carteira' || label === 'Status' ? `${label}: ${lbl}` : lbl}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b8f9a] pointer-events-none" />
    </div>
  )
}

function DirectionChip({ up }: { up: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit',
      up
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
        : 'bg-red-500/15 text-red-400 border-red-500/40'
    )}>
      {up ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
      {up ? 'UP' : 'DOWN'}
    </span>
  )
}

function AccountChip({ type }: { type: 'REAL' | 'DEMO' }) {
  const isReal = type === 'REAL'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit',
      isReal
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
        : 'bg-[#1a1e2a] text-[#8b8f9a] border-[#1f232e]'
    )}>
      {isReal ? 'Real' : 'Demo'}
    </span>
  )
}

function StatusChip({ status }: { status: OpRow['status'] }) {
  const map: Record<OpRow['status'], { label: string; tone: string }> = {
    OPEN:      { label: 'Aguardando', tone: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/40' },
    WON:       { label: 'Ganhou',     tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
    LOST:      { label: 'Perdeu',     tone: 'bg-red-500/15 text-red-400 border-red-500/40' },
    CANCELLED: { label: 'Cancelada',  tone: 'bg-[#1a1e2a] text-[#8b8f9a] border-[#1f232e]' },
  }
  const cfg = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit', cfg.tone)}>
      {cfg.label}
    </span>
  )
}

function IconBtn({ children, onClick, disabled, title, tone = 'neutral' }:
  { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; tone?: 'neutral' | 'red' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded border transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
        tone === 'red'
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'border-[#1f232e] text-[#8b8f9a] hover:text-white hover:bg-white/5'
      )}
    >
      {children}
    </button>
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

function ViewModal({ op, onClose }: { op: OpRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-[480px] bg-[#13161f] border border-[#1f232e] rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e]">
          <h3 className="text-sm font-bold text-white">Detalhes da operação</h3>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3 text-xs">
          <DetailRow label="ID"            value={op.id} mono />
          <DetailRow label="Status"        value={<StatusChip status={op.status} />} />
          <DetailRow label="Usuário"       value={op.userName} />
          <DetailRow label="Email"         value={op.userEmail} truncate />
          <DetailRow label="Carteira"      value={<AccountChip type={op.accountType} />} />
          <DetailRow label="Direção"       value={<DirectionChip up={op.direction === 'CALL'} />} />
          <DetailRow label="Mercado"       value={op.assetSymbol} mono />
          <DetailRow label="Timeframe"     value={formatTimeframe(op.timeframeSec)} />
          <DetailRow label="Apostado"      value={`R$ ${fmtBRL(op.amount)}`} />
          <DetailRow label="Payout"        value={`${op.payout}%`} />
          <DetailRow label="Preço entrada" value={op.entryPrice} mono />
          <DetailRow label="Preço saída"   value={op.exitPrice ?? '—'} mono />
          <DetailRow label="Aberta em"     value={formatDateTime(op.openedAt)} />
          <DetailRow label="Expira em"     value={formatDateTime(op.expiresAt)} />
          <DetailRow label="Fechada em"    value={op.closedAt ? formatDateTime(op.closedAt) : '—'} />
          <DetailRow label="Lucro/Perda"   value={op.profit ?? '—'} />
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono, truncate }: { label: string; value: React.ReactNode; mono?: boolean; truncate?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-[#8b8f9a] mb-0.5">{label}</div>
      <div className={cn('text-xs text-white', mono && 'font-mono', truncate && 'truncate')}>{value}</div>
    </div>
  )
}

function fmtBRL(s: string | number) {
  const n = typeof s === 'number' ? s : (parseFloat(s) || 0)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy}\n${hh}:${mi}:${ss}`
}

function formatTimeframe(sec: number) {
  if (sec < 60)    return `${sec}s`
  if (sec < 3600)  return `${Math.round(sec / 60)}m`
  return `${Math.round(sec / 3600)}h`
}
