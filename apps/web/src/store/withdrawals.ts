import { create } from 'zustand'
import { api } from '@/lib/api'

export type WithdrawalStatus  = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'FAILED'
export type WithdrawalMethod  = 'PIX' | 'USDT_TRC20' | 'BANK_TRANSFER'

export interface ApiWithdrawal {
  id:          string
  accountId:   string
  amount:      string
  method:      WithdrawalMethod
  destination: string
  status:      WithdrawalStatus
  notes:       string | null
  createdAt:   string
  updatedAt:   string
  processedAt: string | null
}

interface WithdrawalsState {
  withdrawals: ApiWithdrawal[]
  loading:     boolean
  hydrated:    boolean

  hydrate:   (rows: ApiWithdrawal[]) => void
  refetch:   () => Promise<void>
  upsertOne: (w: ApiWithdrawal) => void
  reset:     () => void
}

export const useWithdrawalsStore = create<WithdrawalsState>((set, get) => ({
  withdrawals: [],
  loading:     false,
  hydrated:    false,

  hydrate: (rows) => set({ withdrawals: rows, hydrated: true, loading: false }),

  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data } = await api.get('/withdrawals')
      set({ withdrawals: data?.withdrawals ?? [], hydrated: true, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  upsertOne: (w) => {
    const prev = get().withdrawals
    const idx  = prev.findIndex((x) => x.id === w.id)
    const next = idx >= 0
      ? prev.map((x, i) => (i === idx ? w : x))
      : [w, ...prev].slice(0, 50)
    set({ withdrawals: next })
  },

  reset: () => set({ withdrawals: [], hydrated: false, loading: false }),
}))
