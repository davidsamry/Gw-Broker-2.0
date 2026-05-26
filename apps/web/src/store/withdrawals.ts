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

// ── Cache (localStorage) — same SWR pattern as the operations cache ────────
// Hydrated by /auth/me on app init alongside ops + transactions, so the
// Retirada tab is also empty until /auth/me lands. Cache fixes the flash.
const WD_CACHE_KEY = 'vx_withdrawals_cache_v1'
const WD_CACHE_TTL = 5 * 60 * 1000

interface WdCache { withdrawals: ApiWithdrawal[]; savedAt: number }

function loadWdCache(): ApiWithdrawal[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(WD_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WdCache
    if (Date.now() - parsed.savedAt > WD_CACHE_TTL) return null
    return Array.isArray(parsed.withdrawals) ? parsed.withdrawals : null
  } catch {
    return null
  }
}

function saveWdCache(rows: ApiWithdrawal[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WD_CACHE_KEY, JSON.stringify({ withdrawals: rows, savedAt: Date.now() }))
  } catch { /* quota / private mode — ignore */ }
}

function clearWdCache() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(WD_CACHE_KEY) } catch { /* ignore */ }
}

interface WithdrawalsState {
  withdrawals: ApiWithdrawal[]
  loading:     boolean
  hydrated:    boolean

  hydrate:       (rows: ApiWithdrawal[]) => void
  loadFromCache: () => void
  refetch:       () => Promise<void>
  upsertOne:     (w: ApiWithdrawal) => void
  reset:         () => void
}

export const useWithdrawalsStore = create<WithdrawalsState>((set, get) => ({
  withdrawals: [],
  loading:     false,
  hydrated:    false,

  hydrate: (rows) => {
    saveWdCache(rows)
    set({ withdrawals: rows, hydrated: true, loading: false })
  },

  loadFromCache: () => {
    if (get().hydrated) return
    const cached = loadWdCache()
    if (cached) set({ withdrawals: cached, hydrated: true })
  },

  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data } = await api.get('/withdrawals')
      const rows = data?.withdrawals ?? []
      saveWdCache(rows)
      set({ withdrawals: rows, hydrated: true, loading: false })
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
    saveWdCache(next)
    set({ withdrawals: next })
  },

  reset: () => {
    clearWdCache()
    set({ withdrawals: [], hydrated: false, loading: false })
  },
}))
