import { create } from 'zustand'
import { api } from '@/lib/api'

// Shape returned by the API for a single operation. Kept loose (strings for
// Decimal-typed fields) to match what comes off the wire.
export interface ApiOperation {
  id:          string
  accountId?:  string
  assetId:     string
  assetSymbol: string
  direction:   'CALL' | 'PUT'
  amount:      string
  payout:      number
  profit:      string | null
  status:      'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  entryPrice?: string
  expiresAt:   string
  openedAt:    string
  closedAt:    string | null
}

interface OperationsState {
  operations: ApiOperation[]
  loading:    boolean
  hydrated:   boolean  // true once we've seen at least one fetch / hydrate

  hydrate:    (ops: ApiOperation[]) => void
  refetch:    () => Promise<void>
  upsertOne:  (op: ApiOperation) => void
  reset:      () => void
}

export const useOperationsStore = create<OperationsState>((set, get) => ({
  operations: [],
  loading:    false,
  hydrated:   false,

  hydrate: (ops) => set({ operations: ops, hydrated: true, loading: false }),

  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data } = await api.get('/operations')
      set({ operations: data?.operations ?? [], hydrated: true, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  // Insert or replace a single op (matched by id). New ops go to the front.
  upsertOne: (op) => {
    const prev = get().operations
    const idx  = prev.findIndex((o) => o.id === op.id)
    const next = idx >= 0
      ? prev.map((o, i) => (i === idx ? op : o))
      : [op, ...prev].slice(0, 50)
    set({ operations: next })
  },

  reset: () => set({ operations: [], hydrated: false, loading: false }),
}))
