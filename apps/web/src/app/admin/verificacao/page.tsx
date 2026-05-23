'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ShieldCheck, Search, RefreshCw, Eye, X, Clock, CheckCircle2, XCircle, ChevronDown,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface KycRow {
  id:               string
  userId:           string
  userName:         string
  userEmail:        string
  realBalance:      string
  documentFrontUrl: string
  documentBackUrl:  string
  selfieUrl:        string
  status:           'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PENDING'
  reason:           string | null
  submittedAt:      string
  reviewedAt:       string | null
  reviewedBy:       string | null
}

interface ListResponse {
  submissions:  KycRow[]
  total:        number
  page:         number
  pageSize:     number
  pendingCount: number
}

type StatusFilter = 'ALL' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

const PAGE_SIZE = 20

export default function AdminVerificacaoPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('SUBMITTED')
  const [viewing, setViewing] = useState<KycRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: any = { page: 1, pageSize: PAGE_SIZE, status }
      if (search.trim()) params.search = search.trim()
      const res = await api.get<ListResponse>('/admin/kyc', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar submissões.')
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => { load() }, [load])

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      {/* Topbar */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck size={20} className="text-emerald-400" />
            Verificação de Documentos
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">
            Aprove ou rejeite documentos de verificação
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && data.pendingCount > 0 && (
            <span className="px-3 py-1.5 rounded-full bg-blue-500 text-white text-xs font-bold">
              {data.pendingCount} pendente{data.pendingCount === 1 ? '' : 's'}
            </span>
          )}
          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#13161f] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-4 flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou email..."
            className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-8 pr-3 text-xs text-white placeholder-[#8b8f9a] outline-none focus:border-emerald-500/50"
          />
        </div>

        <div className="relative">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-3 pr-8 text-xs text-white outline-none focus:border-emerald-500/50 appearance-none cursor-pointer"
          >
            <option value="SUBMITTED">Em análise</option>
            <option value="APPROVED">Aprovados</option>
            <option value="REJECTED">Rejeitados</option>
            <option value="ALL">Todos</option>
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b8f9a] pointer-events-none" />
        </div>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl overflow-hidden">
        <div className="hidden md:grid grid-cols-[1fr_140px_140px_140px_1fr_180px] gap-3 px-4 py-3 border-b border-[#1f232e] text-[10px] font-bold text-[#8b8f9a] uppercase tracking-wide">
          <span>Usuário</span>
          <span>Saldo Real</span>
          <span>Status</span>
          <span>Data de Envio</span>
          <span>Motivo Rejeição</span>
          <span className="text-right">Ações</span>
        </div>

        {loading && !data ? (
          <div className="py-12 text-center text-sm text-[#8b8f9a]">Carregando…</div>
        ) : data && data.submissions.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#8b8f9a]">
            Nenhuma submissão encontrada com esse filtro.
          </div>
        ) : (
          data?.submissions.map((s) => (
            <div key={s.id} className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_140px_1fr_180px] gap-3 px-4 py-3 border-b border-[#1f232e]/50 items-center">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{s.userName || '—'}</div>
                <div className="text-[11px] text-[#8b8f9a] truncate">{s.userEmail}</div>
              </div>
              <div className="text-sm text-emerald-400 font-semibold">R$ {fmtBRL(s.realBalance)}</div>
              <StatusChip status={s.status} />
              <div className="text-xs text-[#8b8f9a]">{formatDate(s.submittedAt)}</div>
              <div className="text-xs text-[#8b8f9a] truncate" title={s.reason ?? ''}>
                {s.reason || '—'}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setViewing(s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#1a1e2a] text-xs font-semibold text-white hover:bg-white/5 transition-colors"
                >
                  <Eye size={12} />
                  Ver Documentos
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {viewing && (
        <DocumentsModal
          submission={viewing}
          onClose={() => setViewing(null)}
          onDecided={async () => { await load(); setViewing(null) }}
        />
      )}
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function StatusChip({ status }: { status: KycRow['status'] }) {
  const map: Record<KycRow['status'], { label: string; tone: string; icon: React.ReactNode }> = {
    PENDING:   { label: 'Pendente',   tone: 'bg-[#1a1e2a] text-[#8b8f9a] border-[#1f232e]',          icon: <Clock size={9} /> },
    SUBMITTED: { label: 'Em análise', tone: 'bg-blue-500/15 text-blue-400 border-blue-500/40',      icon: <Clock size={9} /> },
    APPROVED:  { label: 'Aprovado',   tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40', icon: <CheckCircle2 size={9} /> },
    REJECTED:  { label: 'Rejeitado',  tone: 'bg-red-500/15 text-red-400 border-red-500/40',         icon: <XCircle size={9} /> },
  }
  const cfg = map[status] ?? map.PENDING
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit', cfg.tone)}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

function DocumentsModal({
  submission, onClose, onDecided,
}: { submission: KycRow; onClose: () => void; onDecided: () => void }) {
  const [rejectMode, setRejectMode] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState('')

  const pending = submission.status === 'SUBMITTED'

  async function approve() {
    setLoading('approve'); setError('')
    try {
      await api.post(`/admin/kyc/${submission.id}/approve`)
      onDecided()
    } catch (err: any) {
      if (err?.response?.data?.error === 'NOT_PENDING') setError('Já foi revisada por outro admin.')
      else                                              setError('Erro ao aprovar.')
    } finally {
      setLoading(null)
    }
  }

  async function reject() {
    if (reason.trim().length < 3) { setError('Motivo deve ter pelo menos 3 caracteres.'); return }
    setLoading('reject'); setError('')
    try {
      await api.post(`/admin/kyc/${submission.id}/reject`, { reason: reason.trim() })
      onDecided()
    } catch (err: any) {
      if (err?.response?.data?.error === 'NOT_PENDING') setError('Já foi revisada por outro admin.')
      else                                              setError('Erro ao rejeitar.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-[860px] bg-[#13161f] border border-[#1f232e] rounded-xl shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e] flex-shrink-0">
          <h3 className="text-sm font-bold text-white">Documentos de {submission.userName}</h3>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DocPreview label="Documento (Frente)"  url={submission.documentFrontUrl} />
            <DocPreview label="Documento (Verso)"   url={submission.documentBackUrl}  />
            <DocPreview label="Selfie com Documento" url={submission.selfieUrl}       />
          </div>

          {/* User info */}
          <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
            <Info label="Email"          value={submission.userEmail} />
            <Info label="Saldo REAL"     value={`R$ ${fmtBRL(submission.realBalance)}`} />
            <Info label="Enviado em"     value={formatDateTime(submission.submittedAt)} />
            <Info label="Status atual"   value={<StatusChip status={submission.status} />} />
          </div>

          {submission.status === 'REJECTED' && submission.reason && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="text-[10px] font-bold text-red-400 mb-1">MOTIVO DA REJEIÇÃO ANTERIOR</div>
              <div className="text-xs text-[#ccc]">{submission.reason}</div>
            </div>
          )}

          {rejectMode && pending && (
            <div className="mt-4">
              <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Motivo da rejeição (será enviado ao usuário)</label>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Ex.: documento ilegível, selfie sem o documento ao lado, etc."
                className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/60 resize-none"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[#1f232e] flex-shrink-0">
          <div className="text-xs text-[#8b8f9a] flex items-center gap-1.5">
            {pending ? (
              <><Clock size={12} className="text-blue-400" />Aguardando análise</>
            ) : (
              <>Já revisada</>
            )}
          </div>

          {pending && (
            <div className="flex items-center gap-2">
              {rejectMode ? (
                <>
                  <button
                    onClick={() => { setRejectMode(false); setReason(''); setError('') }}
                    className="px-3 py-2 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white transition-colors"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={reject}
                    disabled={loading !== null || reason.trim().length < 3}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-xs font-bold text-white transition-colors disabled:opacity-50"
                  >
                    <XCircle size={13} />
                    {loading === 'reject' ? 'Rejeitando…' : 'Confirmar rejeição'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setRejectMode(true)}
                    disabled={loading !== null}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#1f232e] bg-[#1a1e2a] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    <XCircle size={13} />
                    Rejeitar
                  </button>
                  <button
                    onClick={approve}
                    disabled={loading !== null}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-black transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 size={13} />
                    {loading === 'approve' ? 'Aprovando…' : 'Aprovar'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DocPreview({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-bold text-white">{label}</div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-[4/3] rounded-lg overflow-hidden bg-[#1a1e2a] border border-[#1f232e] hover:border-emerald-500/40 transition-colors"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          className="w-full h-full object-cover"
          onError={(e) => {
            const t = e.currentTarget
            t.style.display = 'none'
            const sib = t.nextElementSibling as HTMLElement | null
            if (sib) sib.style.display = 'flex'
          }}
        />
        <div className="w-full h-full hidden items-center justify-center text-xs text-[#8b8f9a] p-3 text-center">
          Não foi possível carregar a imagem
        </div>
      </a>
      <div className="text-[10px] text-[#8b8f9a] font-mono truncate" title={url}>
        {url}
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-[#0f1117] border border-[#1f232e]">
      <div className="text-[10px] text-[#8b8f9a] mb-0.5">{label}</div>
      <div className="text-xs text-white">{value}</div>
    </div>
  )
}

function fmtBRL(s: string) {
  return (parseFloat(s) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR')
}
