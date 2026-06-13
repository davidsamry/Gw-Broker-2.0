import { create } from 'zustand'
import { api } from '@/lib/api'

export type TransactionType =
  | 'DEMO_CREDIT' | 'DEPOSIT' | 'WITHDRAWAL'
  | 'TRADE_WIN'   | 'TRADE_LOSS' | 'BONUS'
  | 'COPY_PURCHASE'

export interface ApiTransaction {
  id:          string
  accountId:   string
  type:        TransactionType
  amount:      string
  description: string | null
  createdAt:   string
}

// ── Cache (localStorage) — same SWR pattern as operations + withdrawals ────
// Transações tab reads from this store; hydrated by /auth/me on app init.
const TX_CACHE_KEY = 'vx_transactions_cache_v1'
const TX_CACHE_TTL = 5 * 60 * 1000

interface TxCache { transactions: ApiTransaction[]; savedAt: number }

function loadTxCache(): ApiTransaction[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(TX_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TxCache
    if (Date.now() - parsed.savedAt > TX_CACHE_TTL) return null
    return Array.isArray(parsed.transactions) ? parsed.transactions : null
  } catch {
    return null
  }
}

function saveTxCache(rows: ApiTransaction[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TX_CACHE_KEY, JSON.stringify({ transactions: rows, savedAt: Date.now() }))
  } catch { /* quota / private mode — ignore */ }
}

function clearTxCache() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(TX_CACHE_KEY) } catch { /* ignore */ }
}

interface TransactionsState {
  transactions: ApiTransaction[]
  loading:      boolean
  hydrated:     boolean

  hydrate:       (rows: ApiTransaction[]) => void
  loadFromCache: () => void
  refetch:       () => Promise<void>
  reset:         () => void
}

export const useTransactionsStore = create<TransactionsState>((set, get) => ({
  transactions: [],
  loading:      false,
  hydrated:     false,

  hydrate: (rows) => {
    saveTxCache(rows)
    set({ transactions: rows, hydrated: true, loading: false })
  },

  loadFromCache: () => {
    if (get().hydrated) return
    const cached = loadTxCache()
    if (cached) set({ transactions: cached, hydrated: true })
  },

  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data } = await api.get('/transactions')
      const rows = data?.transactions ?? []
      saveTxCache(rows)
      set({ transactions: rows, hydrated: true, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  reset: () => {
    clearTxCache()
    set({ transactions: [], hydrated: false, loading: false })
  },
}))
