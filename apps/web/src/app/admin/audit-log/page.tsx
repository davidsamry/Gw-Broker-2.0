'use client'

// /admin/audit-log — registro de tudo que o admin fez no painel.
// Lista paginada com filtros por tipo de recurso, acao e periodo.
// Clica numa row pra ver o JSON antes/depois expandido.

import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  History, Search, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, RefreshCw, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useDebounce } from '@/lib/useDebounce'
import { cn } from '@/lib/utils'

interface AuditEntry {
  id:           string
  createdAt:    string
  resourceType: string
  resourceId:   string | null
  action:       string
  adminId:      string
  adminEmail:   string | null
  adminName:    string | null
  ip:           string | null
  userAgent:    string | null
  before:       unknown
  after:        unknown
}

interface ListResponse {
  entries:  AuditEntry[]
  total:    number
  page:     number
  pageSize: number
}

const PAGE_SIZE = 50

// Tipos suportados — mantém em sync com o backend (auditLog.ts AuditResourceType).
const RESOURCE_TYPES = [
  'WITHDRAWAL', 'USER', 'DEPOSIT', 'KYC', 'OPERATION',
  'ASSET', 'SETTINGS', 'EMAIL_TEMPLATE', 'BONUS_CODE',
  'RANKING_PRIZE', 'TICKET',
] as const

// Cor do badge por tipo de recurso pra leitura rapida.
const TYPE_COLOR: Record<string, string> = {
  WITHDRAWAL:     'bg-red-500/15    text-red-400    border-red-500/30',
  USER:           'bg-blue-500/15   text-blue-400   border-blue-500/30',
  DEPOSIT:        'bg-green-500/15  text-green-400  border-green-500/30',
  KYC:            'bg-purple-500/15 text-purple-400 border-purple-500/30',
  OPERATION:      'bg-amber-500/15  text-amber-400  border-amber-500/30',
  ASSET:          'bg-cyan-500/15   text-cyan-400   border-cyan-500/30',
  SETTINGS:       'bg-pink-500/15   text-pink-400   border-pink-500/30',
  EMAIL_TEMPLATE: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  BONUS_CODE:     'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  RANKING_PRIZE:  'bg-orange-500/15 text-orange-400 border-orange-500/30',
  TICKET:         'bg-teal-500/15   text-teal-400   border-teal-500/30',
}

export default function AdminAuditLogPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Filtros
  const [resourceType, setResourceType] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [adminSearch,  setAdminSearch]  = useState('')
  const debouncedAdmin = useDebounce(adminSearch, 300)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: any = { page, pageSize: PAGE_SIZE }
      if (resourceType)        params.resourceType = resourceType
      if (actionFilter.trim()) params.action       = actionFilter.trim()
      if (debouncedAdmin.trim()) params.adminId    = debouncedAdmin.trim()
      if (dateFrom)            params.dateFrom     = dateFrom
      if (dateTo)              params.dateTo       = dateTo
      const res = await api.get<ListResponse>('/admin/audit-log', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar audit log.')
    } finally {
      setLoading(false)
    }
  }, [resourceType, actionFilter, debouncedAdmin, dateFrom, dateTo, page])

  useEffect(() => { setPage(1) }, [resourceType, actionFilter, debouncedAdmin, dateFrom, dateTo])
  useEffect(() => { load() }, [load])

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History size={22} className="text-emerald-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Audit Log</h1>
            <p className="text-xs text-zinc-500">
              Registro de todas as ações realizadas no painel administrativo.
            </p>
          </div>
        </div>
        <button
          onClick={() => load()}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw size={13} className="inline" /> Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <select
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-600 focus:outline-none"
        >
          <option value="">Todos os recursos</option>
          {RESOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          type="text"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder="Ação (APPROVE, DELETE, …)"
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="text"
          value={adminSearch}
          onChange={(e) => setAdminSearch(e.target.value)}
          placeholder="Admin ID"
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-600 focus:outline-none"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-600 focus:outline-none"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Recurso</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {loading && !data ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Carregando…</td></tr>
            ) : data && data.entries.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Nenhum registro encontrado.</td></tr>
            ) : (
              data?.entries.map((e) => (
                <Fragment key={e.id}>
                  <tr className="text-zinc-300 hover:bg-zinc-900/40">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{fmtDate(e.createdAt)}</td>
                    <td className="px-4 py-2">
                      <span className={cn('inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        TYPE_COLOR[e.resourceType] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700')}>
                        {e.resourceType}
                      </span>
                      {e.resourceId && (
                        <span className="ml-2 font-mono text-[11px] text-zinc-500">{e.resourceId.slice(0, 12)}…</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-200">{e.action}</td>
                    <td className="px-4 py-2 text-zinc-300">
                      <div className="text-xs">{e.adminName ?? e.adminEmail ?? e.adminId.slice(0, 8)}</div>
                      {e.adminEmail && <div className="text-[10px] text-zinc-500">{e.adminEmail}</div>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500">{e.ip ?? '—'}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        {expandedId === e.id ? 'Ocultar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === e.id && (
                    <tr className="bg-zinc-950/40">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <DetailBlock title="Antes" data={e.before} />
                          <DetailBlock title="Depois" data={e.after} />
                        </div>
                        <div className="mt-3 grid gap-2 text-[11px] text-zinc-500 sm:grid-cols-2">
                          <div><span className="text-zinc-600">Admin ID:</span> <span className="font-mono">{e.adminId}</span></div>
                          <div><span className="text-zinc-600">User Agent:</span> <span className="font-mono">{e.userAgent ?? '—'}</span></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginacao */}
      {data && data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
          <div>
            {(data.page - 1) * PAGE_SIZE + 1}–{Math.min(data.page * PAGE_SIZE, data.total)} de {data.total}
          </div>
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => setPage(1)}                disabled={page === 1}><ChevronsLeft size={14} /></PageBtn>
            <PageBtn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft  size={14} /></PageBtn>
            <span className="px-2">Página {page} de {totalPages}</span>
            <PageBtn onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight size={14} /></PageBtn>
            <PageBtn onClick={() => setPage(totalPages)}       disabled={page === totalPages}><ChevronsRight size={14} /></PageBtn>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-zinc-300">
        {data == null ? <span className="text-zinc-600">—</span> : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

function PageBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-300',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-zinc-800',
      )}
    >
      {children}
    </button>
  )
}
