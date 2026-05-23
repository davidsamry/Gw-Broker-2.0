import { create } from 'zustand'
import { api } from '@/lib/api'

export type TransactionType =
  | 'DEMO_CREDIT' | 'DEPOSIT' | 'WITHDRAWAL'
  | 'TRADE_WIN'   | 'TRADE_LOSS' | 'BONUS'

export interface ApiTransaction {
  id:          string
  accountId:   string
  type:        TransactionType
  amount:      string
  description: string | null
  createdAt:   string
}

interface TransactionsState {
  transactions: ApiTransaction[]
  loading:      boolean
  hydrated:     boolean

  hydrate: (rows: ApiTransaction[]) => void
  refetch: () => Promise<void>
  reset:   () => void
}

export const useTransactionsStore = create<TransactionsState>((set, get) => ({
  transactions: [],
  loading:      false,
  hydrated:     false,

  hydrate: (rows) => set({ transactions: rows, hydrated: true, loading: false }),

  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data } = await api.get('/transactions')
      set({ transactions: data?.transactions ?? [], hydrated: true, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  reset: () => set({ transactions: [], hydrated: false, loading: false }),
}))
