'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUpFromLine, DollarSign, CheckCircle2, Receipt, RefreshCw, Search, XCircle,
  Clock, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check, Zap,
} from 'lucide-react'
import { api } from '@/lib/api'
import { KpiCard } from '@/components/admin/KpiCard'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/lib/useDebounce'

interface WithdrawalRow {
  id:          string
  accountId:   string
  userId:      string
  userName:    string
  userEmail:   string
  userCpf:     string | null
  amount:      string
  method:      'PIX' | 'USDT_TRC20' | 'BANK_TRANSFER'
  destination: string
  status:      'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
  notes:       string | null
  createdAt:   string
  processedAt: string | null
}

interface Counts {
  total:       number
  paid:        number
  pending:     number
  totalAmount: string
  paidAmount:  string
  ticketAvg:   string
}

interface ListResponse {
  withdrawals: WithdrawalRow[]
  total:       number
  page:        number
  pageSize:    number
  counts:      Counts
}

type StatusTab = 'ALL' | 'PENDING' | 'COMPLETED'
const PAGE_SIZE = 25

const METHOD_LABEL: Record<WithdrawalRow['method'], string> = {
  PIX:           'PIX',
  USDT_TRC20:    'USDT',
  BANK_TRANSFER: 'Banco',
}

// Heuristic to label the PIX key type the same way the reference design does
// (cpf / email / phone / random). Pure visual hint — server stores the raw key.
function pixKeyType(key: string): string {
  const k = key.trim()
  if (/^\d{11}$/.test(k.replace(/\D/g, ''))) return 'cpf'
  if (/^\d{14}$/.test(k.replace(/\D/g, ''))) return 'cnpj'
  if (k.includes('@'))                       return 'email'
  if (/^\+?\d{10,15}$/.test(k.replace(/\D/g, ''))) return 'telefone'
  if (k.length >= 32)                        return 'aleatória'
  return 'chave'
}

export default function AdminSaquesPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [search, setSearch] = useState('')
  // 300ms debounce — input stays instant, API only fires after typing pause.
  const debouncedSearch     = useDebounce(search, 300)
  const [tab, setTab]       = useState<StatusTab>('ALL')
  const [page, setPage]     = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<WithdrawalRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: any = { page, pageSize: PAGE_SIZE }
      if (debouncedSearch.trim())   params.search = debouncedSearch.trim()
      if (tab !== 'ALL')   params.status = tab
      const res = await api.get<ListResponse>('/admin/withdrawals', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar saques.')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, tab, page])

  useEffect(() => { setPage(1) }, [debouncedSearch, tab])
  useEffect(() => { load() }, [load])

  async function approve(w: WithdrawalRow) {
    if (busyId || w.status !== 'PENDING') return
    if (!confirm(`Confirmar pagamento de R$ ${fmtBRL(w.amount)} para ${w.userEmail}?\n\nIMPORTANTE: você deve ter feito o PIX manualmente antes de confirmar aqui.`)) return
    setBusyId(w.id)
    try {
      await api.post(`/admin/withdrawals/${w.id}/approve`)
      await load()
    } catch (err: any) {
      if (err?.response?.data?.error === 'WITHDRAWAL_NOT_PENDING') {
        alert('Este saque não está mais pendente.')
      } else {
        alert('Erro ao aprovar.')
      }
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
            <ArrowUpFromLine size={20} className="text-emerald-400" />
            Gestão de Saques
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">Gerencie as solicitações de saque dos usuários</p>
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
          label="Saques Gerados"
          value={String(counts?.total ?? 0)}
          hint={`R$ ${fmtBRL(counts?.totalAmount ?? '0')} total`}
          icon={<Receipt size={14} />}
          tone="bg-blue-500/15 text-blue-400"
        />
        <KpiCard
          label="Saques Pagos"
          value={String(counts?.paid ?? 0)}
          hint={`R$ ${fmtBRL(counts?.paidAmount ?? '0')} pagos`}
          icon={<CheckCircle2 size={14} />}
          tone="bg-emerald-500/15 text-emerald-400"
          valueTone="text-white"
        />
        <KpiCard
          label="Ticket Médio"
          value={`R$ ${fmtBRL(counts?.ticketAvg ?? '0')}`}
          hint={`${counts?.pending ?? 0} pendentes`}
          icon={<Clock size={14} />}
          tone="bg-yellow-500/15 text-yellow-400"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-3">
        <TabBtn active={tab === 'ALL'}       onClick={() => setTab('ALL')}>Todos ({counts?.total ?? 0})</TabBtn>
        <TabBtn active={tab === 'PENDING'}   onClick={() => setTab('PENDING')}>Pendentes ({counts?.pending ?? 0})</TabBtn>
        <TabBtn active={tab === 'COMPLETED'} onClick={() => setTab('COMPLETED')}>Pagos ({counts?.paid ?? 0})</TabBtn>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, email ou CPF..."
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
          <table className="w-full text-xs min-w-[1280px]">
            <thead>
              <tr className="border-b border-[#1f232e] text-[10px] text-[#8b8f9a] font-bold uppercase tracking-wide">
                <th className="text-left  px-4 py-3">Nome</th>
                <th className="text-left  px-3 py-3">CPF</th>
                <th className="text-left  px-3 py-3">Tipo Conta</th>
                <th className="text-left  px-3 py-3">Tipo Saque</th>
                <th className="text-right px-3 py-3">Valor</th>
                <th className="text-left  px-3 py-3">Chave PIX</th>
                <th className="text-left  px-3 py-3">Status</th>
                <th className="text-left  px-3 py-3">Data Solicitação</th>
                <th className="text-center px-3 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-[#8b8f9a]">Carregando…</td></tr>
              ) : data && data.withdrawals.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-[#8b8f9a]">Nenhum saque encontrado.</td></tr>
              ) : (
                data?.withdrawals.map((w) => {
                  const pending = w.status === 'PENDING'
                  return (
                    <tr key={w.id} className="border-b border-[#1f232e]/50 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-white truncate max-w-[220px]">{w.userName || '—'}</div>
                        <div className="text-[10px] text-[#8b8f9a] font-mono">{w.id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-3 py-3 text-[#8b8f9a] font-mono">{w.userCpf || '—'}</td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-500/15 text-emerald-400 border-emerald-500/40">
                          Real
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-[#1a1e2a] text-white border-[#1f232e]">
                          Saldo
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-white font-medium whitespace-nowrap">R$ {fmtBRL(w.amount)}</td>
                      <td className="px-3 py-3">
                        <div className="text-white font-mono truncate max-w-[180px]">{w.destination}</div>
                        <div className="text-[10px] text-[#8b8f9a]">{w.method === 'PIX' ? pixKeyType(w.destination) : METHOD_LABEL[w.method]}</div>
                      </td>
                      <td className="px-3 py-3"><StatusChip status={w.status} /></td>
                      <td className="px-3 py-3 text-[#8b8f9a] whitespace-nowrap">{formatDateTime(w.createdAt)}</td>
                      <td className="px-3 py-3">
                        {pending ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => approve(w)}
                              disabled={busyId === w.id}
                              title="Confirmar pagamento (você já fez o PIX)"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30 transition-colors text-[10px] font-semibold"
                            >
                              <Check size={11} /> Aprovar
                            </button>
                            <button
                              onClick={() => setRejecting(w)}
                              disabled={busyId === w.id}
                              title="Rejeitar e devolver saldo"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-30 transition-colors text-[10px] font-semibold"
                            >
                              <X size={11} /> Rejeitar
                            </button>
                          </div>
                        ) : (
                          <div className="text-center text-[#8b8f9a]">—</div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.withdrawals.length > 0 && (
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

      {rejecting && (
        <RejectModal
          withdrawal={rejecting}
          onClose={() => setRejecting(null)}
          onDone={async () => { await load(); setRejecting(null) }}
        />
      )}
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

function StatusChip({ status }: { status: WithdrawalRow['status'] }) {
  const map: Record<WithdrawalRow['status'], { label: string; tone: string }> = {
    PENDING:   { label: 'Pendente',  tone: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/40' },
    APPROVED:  { label: 'Aprovado',  tone: 'bg-blue-500/15 text-blue-400 border-blue-500/40' },
    COMPLETED: { label: 'Pago',      tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
    CANCELLED: { label: 'Cancelado', tone: 'bg-red-500/15 text-red-400 border-red-500/40' },
    FAILED:    { label: 'Falhou',    tone: 'bg-red-500/15 text-red-400 border-red-500/40' },
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

// Respostas rápidas (modelos prontos) — admin clica e preenche o campo de
// motivo, podendo editar antes de confirmar. Mesmo padrão de /admin/tickets.
const QUICK_REPLIES: { title: string; body: string }[] = [
  {
    title: 'Rollover pendente',
    body: 'Conforme os termos aceitos no momento da inscrição, é necessário cumprir o rollover correspondente ao valor depositado para que a função de saque seja liberada.\n\nEnquanto essa exigência não for concluída, não será possível realizar saques da conta. Após atingir a movimentação necessária, a solicitação de saque poderá ser efetuada normalmente.',
  },
]

function RejectModal({
  withdrawal, onClose, onDone,
}: { withdrawal: WithdrawalRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)

  async function submit() {
    if (reason.trim().length < 3) { setError('Motivo precisa ter pelo menos 3 caracteres.'); return }
    setLoading(true); setError('')
    try {
      await api.post(`/admin/withdrawals/${withdrawal.id}/reject`, { reason: reason.trim() })
      onDone()
    } catch (err: any) {
      if (err?.response?.data?.error === 'WITHDRAWAL_NOT_PENDING') setError('Este saque não está mais pendente.')
      else                                                          setError('Erro ao rejeitar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] bg-[#13161f] border border-[#1f232e] rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e]">
          <h3 className="text-sm font-bold text-white">Rejeitar saque</h3>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-xs text-[#ccc] leading-relaxed">
            Rejeitar este saque vai <strong>devolver R$ {fmtBRL(withdrawal.amount)} ao saldo</strong> de{' '}
            <strong>{withdrawal.userName || withdrawal.userEmail}</strong>.
          </p>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium text-[#8b8f9a] block">Motivo (visível ao usuário no histórico)</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTemplates((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] text-[#8b8f9a] hover:text-red-400 transition-colors"
                >
                  <Zap size={12} /> Respostas rápidas
                </button>
                {showTemplates && (
                  <div className="absolute top-full right-0 mt-1 w-72 max-h-64 overflow-y-auto bg-[#1a1e2a] border border-[#1f232e] rounded-lg shadow-xl z-10">
                    {QUICK_REPLIES.map((q) => (
                      <button
                        key={q.title}
                        type="button"
                        onClick={() => { setReason(q.body); setShowTemplates(false) }}
                        className="block w-full text-left px-3 py-2 hover:bg-white/5 transition-colors border-b border-[#1f232e] last:border-b-0"
                      >
                        <div className="text-xs font-medium text-white">{q.title}</div>
                        <div className="text-[10px] text-[#8b8f9a] truncate mt-0.5">{q.body}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Ex.: chave PIX inválida, CPF não bate com o dono da chave..."
              className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-red-500/60 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white">Cancelar</button>
            <button
              onClick={submit}
              disabled={loading || reason.trim().length < 3}
              className="flex-1 h-9 rounded-lg bg-red-500 hover:bg-red-400 text-xs font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <XCircle size={13} />
              {loading ? 'Rejeitando…' : 'Confirmar rejeição'}
            </button>
          </div>
        </div>
      </div>
    </div>
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
