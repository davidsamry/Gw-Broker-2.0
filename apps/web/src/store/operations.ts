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

// ── Cache (localStorage) — same SWR pattern as the user cache ──────────────
// Operations come from /auth/me on app init, which fans out 5 parallel
// queries server-side. Even at p50 that's 200-500ms before the FECHADAS
// list renders. Cache lets us paint last-seen ops in <16ms and revalidate
// in the background — server stays source of truth.
//
// Bump the v if the ApiOperation shape changes, so old clients don't
// read a malformed cache.
const OPS_CACHE_KEY = 'vx_operations_cache_v1'
const OPS_CACHE_TTL = 5 * 60 * 1000 // 5 min

interface OpsCache { operations: ApiOperation[]; savedAt: number }

function loadOpsCache(): ApiOperation[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(OPS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OpsCache
    if (Date.now() - parsed.savedAt > OPS_CACHE_TTL) return null
    return Array.isArray(parsed.operations) ? parsed.operations : null
  } catch {
    return null
  }
}

function saveOpsCache(ops: ApiOperation[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(OPS_CACHE_KEY, JSON.stringify({ operations: ops, savedAt: Date.now() }))
  } catch { /* quota / private mode — ignore */ }
}

function clearOpsCache() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(OPS_CACHE_KEY) } catch { /* ignore */ }
}

interface OperationsState {
  operations: ApiOperation[]
  loading:    boolean
  hydrated:   boolean  // true once we've seen at least one fetch / hydrate / cache load

  hydrate:        (ops: ApiOperation[]) => void
  loadFromCache:  () => void
  refetch:        () => Promise<void>
  upsertOne:      (op: ApiOperation) => void
  reset:          () => void
}

export const useOperationsStore = create<OperationsState>((set, get) => ({
  operations: [],
  loading:    false,
  hydrated:   false,

  // Server hydrate — saves to cache so the next reload paints instantly.
  hydrate: (ops) => {
    saveOpsCache(ops)
    set({ operations: ops, hydrated: true, loading: false })
  },

  // Synchronous cache restore — call from init() before the /auth/me await
  // so FECHADAS / Histórico render with last-seen ops while we revalidate.
  // Noop if cache is empty/expired — state stays unhydrated and the panels
  // show their loading skeleton until /auth/me lands.
  loadFromCache: () => {
    if (get().hydrated) return
    const cached = loadOpsCache()
    if (cached) set({ operations: cached, hydrated: true })
  },

  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data } = await api.get('/operations')
      const ops = data?.operations ?? []
      saveOpsCache(ops)
      set({ operations: ops, hydrated: true, loading: false })
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
    saveOpsCache(next)
    set({ operations: next })
  },

  reset: () => {
    clearOpsCache()
    set({ operations: [], hydrated: false, loading: false })
  },
}))
