'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  MessageSquare, RefreshCw, Search, X, Send, User as UserIcon, Shield,
  Paperclip, ImageOff,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types — must match apps/api/src/admin/tickets/service.ts ─────────────────
type TicketStatus   = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH'

interface TicketRow {
  id:             string
  userId:         string
  userName:       string
  userEmail:      string
  subject:        string
  status:         TicketStatus
  priority:       TicketPriority
  createdAt:      string
  lastActivityAt: string
  messageCount:   number
}

interface TicketMessage {
  id:            string
  ticketId:      string
  authorId:      string
  authorName:    string
  isAdmin:       boolean
  body:          string
  attachmentUrl: string | null
  createdAt:     string
}

interface TicketDetail extends TicketRow {
  messages: TicketMessage[]
}

interface Counts {
  total:      number
  open:       number
  inProgress: number
  resolved:   number
  closed:     number
}

interface ListResponse {
  tickets:  TicketRow[]
  total:    number
  page:     number
  pageSize: number
  counts:   Counts
}

type StatusFilter = 'ALL' | TicketStatus
const PAGE_SIZE = 50

// ── Labels and chip colours ──────────────────────────────────────────────────
const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN:        'Aberto',
  IN_PROGRESS: 'Em andamento',
  RESOLVED:    'Resolvido',
  CLOSED:      'Fechado',
}

const STATUS_CHIP: Record<TicketStatus, string> = {
  OPEN:        'bg-blue-500/15 text-blue-400 border-blue-500/30',
  IN_PROGRESS: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  RESOLVED:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CLOSED:      'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW:    'Baixa',
  MEDIUM: 'Média',
  HIGH:   'Alta',
}

const PRIORITY_CHIP: Record<TicketPriority, string> = {
  LOW:    'bg-gray-500/15 text-gray-400 border-gray-500/30',
  MEDIUM: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  HIGH:   'bg-red-500/15 text-red-400 border-red-500/30',
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL',         label: 'Todos'        },
  { value: 'OPEN',        label: 'Aberto'       },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'RESOLVED',    label: 'Resolvido'    },
  { value: 'CLOSED',      label: 'Fechado'      },
]

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy} ${hh}:${mi}`
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AdminTicketsPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ALL')

  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: any = { page: 1, pageSize: PAGE_SIZE }
      if (search.trim()) params.search = search.trim()
      if (status !== 'ALL') params.status = status
      const res = await api.get<ListResponse>('/admin/tickets', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar tickets.')
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => { load() }, [load])

  // Used by drawer to push updates back into the list without re-fetching.
  function patchTicket(id: string, patch: Partial<TicketRow>) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tickets: prev.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }
    })
  }

  const openCount = (data?.counts.open ?? 0) + (data?.counts.inProgress ?? 0)

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Tickets de Suporte</h1>
          <p className="text-xs md:text-sm text-[#8b8f9a] mt-1">
            {openCount} {openCount === 1 ? 'ticket aberto' : 'tickets abertos'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-sm text-white hover:border-emerald-500/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* Filter row */}
      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por assunto ou usuário..."
            className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40 md:w-48"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#0f1117] border border-[#1f232e] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0d13] border-b border-[#1f232e] text-[11px] uppercase text-[#8b8f9a]">
              <tr>
                <th className="text-left font-medium px-4 py-3">Usuário</th>
                <th className="text-left font-medium px-4 py-3">Assunto</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Prioridade</th>
                <th className="text-left font-medium px-4 py-3">Criado em</th>
                <th className="text-right font-medium px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#8b8f9a] text-sm">
                    Carregando…
                  </td>
                </tr>
              )}
              {!loading && data && data.tickets.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#8b8f9a] text-sm">
                    Nenhum ticket encontrado.
                  </td>
                </tr>
              )}
              {data?.tickets.map((t) => (
                <tr key={t.id} className="border-b border-[#1f232e] last:border-b-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[#1a1f2e] border border-[#2a2e3b] flex items-center justify-center text-[#8b8f9a] flex-shrink-0">
                        <UserIcon size={14} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-white truncate">{t.userName}</div>
                        <div className="text-[11px] text-[#8b8f9a] truncate">{t.userEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white">
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[320px]">{t.subject}</span>
                      {t.messageCount > 1 && (
                        <span className="text-[10px] text-[#8b8f9a] flex-shrink-0">· {t.messageCount} msgs</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border', STATUS_CHIP[t.status])}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border', PRIORITY_CHIP[t.priority])}>
                      {PRIORITY_LABEL[t.priority]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#c3c6cf] whitespace-nowrap">
                    {formatDateTime(t.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setOpenId(t.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] hover:border-emerald-500/40 text-xs font-medium text-white transition-colors"
                    >
                      <MessageSquare size={12} />
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && (
        <TicketDrawer
          ticketId={openId}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchTicket(openId, patch)}
          onReply={() => {
            // bump lastActivityAt in the list row so the row jumps to the top
            patchTicket(openId, { lastActivityAt: new Date().toISOString() })
          }}
        />
      )}
    </div>
  )
}

// ── Drawer ───────────────────────────────────────────────────────────────────
function TicketDrawer({
  ticketId, onClose, onPatch, onReply,
}: {
  ticketId: string
  onClose:  () => void
  onPatch:  (patch: Partial<TicketRow>) => void
  onReply:  () => void
}) {
  const [detail, setDetail]   = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [reply, setReply]     = useState('')
  const [attachment, setAttachment]   = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [busy, setBusy]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api.get<{ ticket: TicketDetail }>(`/admin/tickets/${ticketId}`)
      setDetail(res.data.ticket)
    } catch {
      setError('Não foi possível carregar o ticket.')
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  useEffect(() => { load() }, [load])

  async function submitReply(e: FormEvent) {
    e.preventDefault()
    const body = reply.trim()
    if ((!body && !attachment) || sending) return
    setSending(true)
    try {
      const payload: { body?: string; attachmentUrl?: string } = {}
      if (body)       payload.body          = body
      if (attachment) payload.attachmentUrl = attachment
      await api.post(`/admin/tickets/${ticketId}/reply`, payload)
      setReply('')
      setAttachment(null)
      await load()      // refresh thread
      onReply()         // update list row
    } catch {
      setError('Falha ao enviar resposta.')
    } finally {
      setSending(false)
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Imagem maior que 5 MB.')
      return
    }
    setError('')
    const reader = new FileReader()
    reader.onload = () => setAttachment(reader.result as string)
    reader.onerror = () => setError('Falha ao ler a imagem.')
    reader.readAsDataURL(file)
  }

  async function changeStatus(next: TicketStatus) {
    if (!detail || busy || next === detail.status) return
    setBusy(true)
    try {
      await api.patch(`/admin/tickets/${ticketId}/status`, { status: next })
      setDetail({ ...detail, status: next })
      onPatch({ status: next })
    } catch {
      setError('Falha ao atualizar status.')
    } finally {
      setBusy(false)
    }
  }

  async function changePriority(next: TicketPriority) {
    if (!detail || busy || next === detail.priority) return
    setBusy(true)
    try {
      await api.patch(`/admin/tickets/${ticketId}/priority`, { priority: next })
      setDetail({ ...detail, priority: next })
      onPatch({ priority: next })
    } catch {
      setError('Falha ao atualizar prioridade.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full md:w-[640px] h-full bg-[#0f1117] border-l border-[#1f232e] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1f232e] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-[#8b8f9a] mb-1">Ticket</div>
            <h2 className="text-base font-semibold text-white truncate">
              {detail?.subject ?? '...'}
            </h2>
            {detail && (
              <div className="flex items-center gap-2 mt-2">
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border', STATUS_CHIP[detail.status])}>
                  {STATUS_LABEL[detail.status]}
                </span>
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border', PRIORITY_CHIP[detail.priority])}>
                  {PRIORITY_LABEL[detail.priority]}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] flex items-center justify-center text-[#8b8f9a] hover:text-white hover:border-emerald-500/40 transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Status + Priority controls */}
        {detail && (
          <div className="px-5 py-3 border-b border-[#1f232e] grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-[#8b8f9a] block mb-1">Status</label>
              <select
                value={detail.status}
                onChange={(e) => changeStatus(e.target.value as TicketStatus)}
                disabled={busy}
                className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/40 disabled:opacity-50"
              >
                {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-[#8b8f9a] block mb-1">Prioridade</label>
              <select
                value={detail.priority}
                onChange={(e) => changePriority(e.target.value as TicketPriority)}
                disabled={busy}
                className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/40 disabled:opacity-50"
              >
                {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && (
            <div className="text-center text-sm text-[#8b8f9a] py-8">Carregando…</div>
          )}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {error}
            </div>
          )}
          {detail?.messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'rounded-lg border p-3',
                m.isAdmin
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-[#1a1f2e] border-[#2a2e3b]',
              )}
            >
              <div className="flex items-center gap-2 mb-1.5">
                {m.isAdmin
                  ? <Shield size={12} className="text-emerald-400" />
                  : <UserIcon size={12} className="text-[#8b8f9a]" />
                }
                <span className="text-xs font-medium text-white">
                  {m.authorName}
                  {m.isAdmin && <span className="ml-1.5 text-[10px] text-emerald-400">admin</span>}
                </span>
                <span className="text-[10px] text-[#8b8f9a] ml-auto">{formatDateTime(m.createdAt)}</span>
              </div>
              {m.body && (
                <p className="text-sm text-[#dadce5] whitespace-pre-wrap break-words">{m.body}</p>
              )}
              {m.attachmentUrl && (
                <a
                  href={m.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-2 rounded-lg overflow-hidden border border-[#2a2e3b] hover:border-emerald-500/40 transition-colors max-w-[280px]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.attachmentUrl} alt="anexo" className="block w-full h-auto" />
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Reply box */}
        <form onSubmit={submitReply} className="border-t border-[#1f232e] px-5 py-3 space-y-2">
          {attachment && (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachment} alt="prévia" className="h-20 rounded-lg border border-[#2a2e3b]" />
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 hover:bg-red-400 text-white flex items-center justify-center"
                title="Remover anexo"
              >
                <ImageOff size={10} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <label className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white hover:border-emerald-500/40 cursor-pointer transition-colors flex-shrink-0">
              <Paperclip size={15} />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Escreva sua resposta..."
              rows={2}
              className="flex-1 bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40 resize-none"
            />
            <button
              type="submit"
              disabled={(!reply.trim() && !attachment) || sending}
              className="px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Send size={13} />
              Enviar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
