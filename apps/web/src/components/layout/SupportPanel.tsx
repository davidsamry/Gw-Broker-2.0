'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  X, MessageSquare, Plus, ArrowLeft, Send, Paperclip, ImageOff,
  Shield, User as UserIcon, Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  useTicketsStore, type ApiTicket, type ApiTicketMessage,
  type TicketStatus,
} from '@/store/tickets'
import { NovoTicketModal } from './NovoTicketModal'

interface SupportPanelProps {
  onClose: () => void
}

// ── Labels / chips ───────────────────────────────────────────────────────────
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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'agora'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${mi}`
}

export function SupportPanel({ onClose }: SupportPanelProps) {
  const tickets   = useTicketsStore((s) => s.tickets)
  const hydrated  = useTicketsStore((s) => s.hydrated)
  const loading   = useTicketsStore((s) => s.loading)
  const refetch   = useTicketsStore((s) => s.refetch)
  const upsertOne = useTicketsStore((s) => s.upsertOne)

  const [activeId, setActiveId]   = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // First open → load. Subsequent panel opens reuse cached list; user can
  // pull-to-refresh via the explicit refresh hook in the header.
  useEffect(() => {
    if (!hydrated) refetch()
  }, [hydrated, refetch])

  return (
    <>
      {/*
        Width: 320px on desktop (side-panel beside the chart). Full width on
        mobile, where page.tsx renders us as the sole content of the SUPORTE
        tab — no chart competing for vertical space.
      */}
      <div className="flex flex-col bg-[#1a1e2e] md:border-r border-[#2a2e3b] flex-shrink-0 w-full h-full md:w-[320px]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e3b]">
          <div className="flex items-center gap-2.5 min-w-0">
            {activeId && (
              <button
                onClick={() => setActiveId(null)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
                title="Voltar"
              >
                <ArrowLeft size={15} />
              </button>
            )}
            {!activeId && (
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/20">
                <MessageSquare size={16} className="text-white" />
              </div>
            )}
            <h2 className="text-base font-bold text-white truncate">
              {activeId ? 'Ticket' : 'Suporte'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {activeId ? (
          <TicketDetailView ticketId={activeId} />
        ) : (
          <ListView
            tickets={tickets}
            loading={loading && !hydrated}
            onOpen={(id) => setActiveId(id)}
            onCreate={() => setCreateOpen(true)}
          />
        )}
      </div>

      {createOpen && (
        <NovoTicketModal
          onClose={() => setCreateOpen(false)}
          onCreated={(t) => {
            upsertOne(t)
            setCreateOpen(false)
            setActiveId(t.id)
          }}
        />
      )}
    </>
  )
}

// ── List / empty state ───────────────────────────────────────────────────────
function ListView({
  tickets, loading, onOpen, onCreate,
}: {
  tickets:  ApiTicket[]
  loading:  boolean
  onOpen:   (id: string) => void
  onCreate: () => void
}) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#8b8f9a]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#252a3a] border border-[#2a2e3b] flex items-center justify-center mb-5">
          <MessageSquare size={26} className="text-blue-500" />
        </div>
        <p className="text-[13px] text-[#8b8f9a] leading-relaxed mb-5">
          Nenhum ticket ainda.<br />
          Crie um para falar com o suporte.
        </p>
        <button
          onClick={onCreate}
          className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-white text-sm font-bold shadow-md shadow-blue-600/20"
        >
          Criar ticket
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-[#2a2e3b] flex items-center justify-between">
        <span className="text-[11px] text-[#8b8f9a]">{tickets.length} ticket{tickets.length === 1 ? '' : 's'}</span>
        <button
          onClick={onCreate}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-[11px] font-semibold text-white"
        >
          <Plus size={11} />
          Novo
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tickets.map((t) => (
          <button
            key={t.id}
            onClick={() => onOpen(t.id)}
            className="w-full text-left px-4 py-3 border-b border-[#2a2e3b] hover:bg-white/[0.03] transition-colors"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold text-white truncate flex-1">{t.subject}</span>
              <span className="text-[10px] text-[#8b8f9a] flex-shrink-0">{timeAgo(t.lastActivityAt)}</span>
            </div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', STATUS_CHIP[t.status])}>
                {STATUS_LABEL[t.status]}
              </span>
              {t.messageCount > 1 && (
                <span className="text-[10px] text-[#8b8f9a]">{t.messageCount} msgs</span>
              )}
            </div>
            {t.lastBody && (
              <p className="text-[11px] text-[#8b8f9a] line-clamp-2 leading-snug">
                {t.lastIsAdmin && <span className="text-emerald-400 font-medium">Suporte: </span>}
                {t.lastBody}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Detail view (thread + reply box) ────────────────────────────────────────
function TicketDetailView({ ticketId }: { ticketId: string }) {
  const openDetail = useTicketsStore((s) => s.openDetail)
  const refetch    = useTicketsStore((s) => s.refetch)
  const cached     = useTicketsStore((s) => s.detail[ticketId])

  const [loading, setLoading] = useState(!cached)
  const [error, setError]     = useState('')
  const [reply, setReply]     = useState('')
  const [attachment, setAttachment] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const threadRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      await openDetail(ticketId)
    } catch {
      setError('Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [ticketId, openDetail])

  useEffect(() => { load() }, [load])

  // Scroll thread to bottom when new messages arrive.
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [cached?.messages.length])

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

  async function submitReply(e: FormEvent) {
    e.preventDefault()
    const body = reply.trim()
    if ((!body && !attachment) || sending) return
    setSending(true); setError('')
    try {
      const payload: { body?: string; attachmentUrl?: string } = {}
      if (body)       payload.body          = body
      if (attachment) payload.attachmentUrl = attachment
      await api.post(`/tickets/${ticketId}/messages`, payload)
      setReply(''); setAttachment(null)
      // Refetch the thread to pull the persisted message (with id/timestamp
      // from the server) rather than building it client-side. Also re-list
      // so the panel preview / lastActivityAt updates without manual hop.
      await openDetail(ticketId)
      refetch()
    } catch (e: any) {
      setError(e?.response?.data?.error === 'TICKET_NOT_FOUND'
        ? 'Ticket não encontrado.'
        : 'Falha ao enviar resposta.')
    } finally {
      setSending(false)
    }
  }

  if (loading && !cached) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#8b8f9a]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {cached && (
        <div className="px-4 py-2.5 border-b border-[#2a2e3b]">
          <h3 className="text-sm font-semibold text-white truncate">{cached.subject}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', STATUS_CHIP[cached.status])}>
              {STATUS_LABEL[cached.status]}
            </span>
            <span className="text-[10px] text-[#8b8f9a]">aberto em {formatDateTime(cached.createdAt)}</span>
          </div>
        </div>
      )}

      <div ref={threadRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {cached?.messages.map((m) => <MessageBubble key={m.id} m={m} />)}
      </div>

      {error && (
        <div className="px-3 py-2 mx-3 mb-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={submitReply} className="border-t border-[#2a2e3b] px-3 py-2 space-y-2">
        {attachment && (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment} alt="prévia" className="h-16 rounded-md border border-[#2a2e3b]" />
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
        <div className="flex items-end gap-1.5">
          <label className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#252a3a] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white hover:border-blue-500/40 cursor-pointer transition-colors flex-shrink-0">
            <Paperclip size={14} />
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
            placeholder="Digite uma mensagem..."
            rows={1}
            className="flex-1 bg-[#252a3a] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/40 resize-none max-h-32"
          />
          <button
            type="submit"
            disabled={(!reply.trim() && !attachment) || sending}
            className="w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
      </form>
    </div>
  )
}

function MessageBubble({ m }: { m: ApiTicketMessage }) {
  const mine = !m.isAdmin
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className={cn(
        'max-w-[85%] rounded-2xl px-3 py-2',
        mine
          ? 'bg-blue-600/90 text-white rounded-br-sm'
          : 'bg-[#252a3a] border border-[#2a2e3b] text-[#dadce5] rounded-bl-sm',
      )}>
        {!mine && (
          <div className="flex items-center gap-1 mb-1">
            <Shield size={10} className="text-emerald-400" />
            <span className="text-[10px] font-medium text-emerald-400">Suporte</span>
          </div>
        )}
        {m.body && <p className="text-[13px] whitespace-pre-wrap break-words leading-snug">{m.body}</p>}
        {m.attachmentUrl && (
          <a
            href={m.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'block mt-1.5 rounded-lg overflow-hidden border max-w-[200px]',
              mine ? 'border-white/20' : 'border-[#2a2e3b]',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.attachmentUrl} alt="anexo" className="block w-full h-auto" />
          </a>
        )}
      </div>
      <span className="text-[9px] text-[#6b6f7a] mt-0.5 px-1">
        {mine ? <UserIcon size={8} className="inline -mt-0.5" /> : null} {formatDateTime(m.createdAt)}
      </span>
    </div>
  )
}
