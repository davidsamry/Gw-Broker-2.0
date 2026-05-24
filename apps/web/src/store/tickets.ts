import { create } from 'zustand'
import { api } from '@/lib/api'

// Tickets store — mirrors the withdrawals pattern (hydrate / refetch /
// upsertOne / reset), with extras for the detail thread.

export type TicketStatus   = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ApiTicket {
  id:             string
  subject:        string
  status:         TicketStatus
  priority:       TicketPriority
  createdAt:      string
  lastActivityAt: string
  messageCount:   number
  lastBody:       string | null
  lastIsAdmin:    boolean | null
}

export interface ApiTicketMessage {
  id:            string
  ticketId:      string
  authorId:      string
  authorName:    string
  isAdmin:       boolean
  body:          string
  attachmentUrl: string | null
  createdAt:     string
}

export interface ApiTicketDetail extends ApiTicket {
  messages: ApiTicketMessage[]
}

interface TicketsState {
  tickets:  ApiTicket[]
  loading:  boolean
  hydrated: boolean

  // Detail cache — keyed by ticket id. Filled on demand by openDetail().
  detail: Record<string, ApiTicketDetail>

  refetch:    () => Promise<void>
  upsertOne:  (t: ApiTicket) => void
  openDetail: (id: string) => Promise<ApiTicketDetail | null>
  appendMessage: (ticketId: string, msg: ApiTicketMessage) => void
  reset:      () => void
}

export const useTicketsStore = create<TicketsState>((set, get) => ({
  tickets:  [],
  loading:  false,
  hydrated: false,
  detail:   {},

  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data } = await api.get('/tickets')
      set({ tickets: data?.tickets ?? [], hydrated: true, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  upsertOne: (t) => {
    const prev = get().tickets
    const idx  = prev.findIndex((x) => x.id === t.id)
    const next = idx >= 0
      ? prev.map((x, i) => (i === idx ? t : x))
      : [t, ...prev].slice(0, 100)
    set({ tickets: next })
  },

  openDetail: async (id) => {
    try {
      const { data } = await api.get(`/tickets/${id}`)
      const ticket = data?.ticket as ApiTicketDetail
      if (!ticket) return null
      set({ detail: { ...get().detail, [id]: ticket } })
      return ticket
    } catch {
      return null
    }
  },

  // Push a message onto a cached detail thread + bump the list row's
  // lastActivityAt / messageCount / preview.
  appendMessage: (ticketId, msg) => {
    const { detail, tickets } = get()
    const current = detail[ticketId]
    const nextDetail = current
      ? { ...detail, [ticketId]: { ...current, messages: [...current.messages, msg], messageCount: current.messages.length + 1, lastActivityAt: msg.createdAt } }
      : detail
    const nextTickets = tickets.map((t) => t.id === ticketId
      ? {
          ...t,
          messageCount:   t.messageCount + 1,
          lastActivityAt: msg.createdAt,
          lastBody:       msg.body || (msg.attachmentUrl ? '[imagem]' : t.lastBody),
          lastIsAdmin:    msg.isAdmin,
        }
      : t)
    set({ detail: nextDetail, tickets: nextTickets })
  },

  reset: () => set({ tickets: [], detail: {}, hydrated: false, loading: false }),
}))
