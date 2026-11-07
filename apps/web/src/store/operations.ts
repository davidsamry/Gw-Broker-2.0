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
  // DRAW = empate (saída igual à entrada): valor apostado devolvido.
  status:      'OPEN' | 'WON' | 'LOST' | 'CANCELLED' | 'DRAW'
  entryPrice?: string
  expiresAt:   string
  openedAt:    string
  closedAt:    string | null
}

// Operação de COPY TRADING. Mora em outra tabela (copy_trade_operations) e
// não tem ativo, direção nem preço — é trader + resultado. Vem junto no
// /auth/me e aparece no Histórico ao lado das ops REAL e DEMO.
export interface ApiCopyOperation {
  id:         string
  traderId:   string
  traderName: string
  result:     'WIN' | 'LOSS'
  amount:     number
  pnl:        number
  settledAt:  string
}

// ── Cache (localStorage) — same SWR pattern as the user cache ──────────────
// Operations come from /auth/me on app init, which fans out 5 parallel
// queries server-side. Even at p50 that's 200-500ms before the FECHADAS
// list renders. Cache lets us paint last-seen ops in <16ms and revalidate
// in the background — server stays source of truth.
//
// Bump the v if the ApiOperation shape changes, so old clients don't
// read a malformed cache.
// v2: passou a guardar copyOperations junto. O v1 antigo fica orfao e
// expira sozinho — cliente velho nao le' um cache com shape novo.
const OPS_CACHE_KEY = 'vx_operations_cache_v2'
const OPS_CACHE_TTL = 5 * 60 * 1000 // 5 min

interface OpsCache {
  operations:     ApiOperation[]
  copyOperations: ApiCopyOperation[]
  savedAt:        number
}

function loadOpsCache(): Pick<OpsCache, 'operations' | 'copyOperations'> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(OPS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OpsCache
    if (Date.now() - parsed.savedAt > OPS_CACHE_TTL) return null
    if (!Array.isArray(parsed.operations)) return null
    return {
      operations:     parsed.operations,
      copyOperations: Array.isArray(parsed.copyOperations) ? parsed.copyOperations : [],
    }
  } catch {
    return null
  }
}

function saveOpsCache(ops: ApiOperation[], copyOps: ApiCopyOperation[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      OPS_CACHE_KEY,
      JSON.stringify({ operations: ops, copyOperations: copyOps, savedAt: Date.now() }),
    )
  } catch { /* quota / private mode — ignore */ }
}

function clearOpsCache() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(OPS_CACHE_KEY) } catch { /* ignore */ }
}

interface OperationsState {
  operations:     ApiOperation[]
  copyOperations: ApiCopyOperation[]
  loading:        boolean
  hydrated:       boolean  // true once we've seen at least one fetch / hydrate / cache load

  hydrate:        (ops: ApiOperation[], copyOps?: ApiCopyOperation[]) => void
  loadFromCache:  () => void
  refetch:        () => Promise<void>
  upsertOne:      (op: ApiOperation) => void
  reset:          () => void
}

export const useOperationsStore = create<OperationsState>((set, get) => ({
  operations:     [],
  copyOperations: [],
  loading:        false,
  hydrated:       false,

  // Server hydrate — saves to cache so the next reload paints instantly.
  // copyOps omitido (chamada antiga) preserva o que ja' estava em memoria,
  // em vez de zerar a lista de copy sem querer.
  hydrate: (ops, copyOps) => {
    const copy = copyOps ?? get().copyOperations
    saveOpsCache(ops, copy)
    set({ operations: ops, copyOperations: copy, hydrated: true, loading: false })
  },

  // Synchronous cache restore — call from init() before the /auth/me await
  // so FECHADAS / Histórico render with last-seen ops while we revalidate.
  // Noop if cache is empty/expired — state stays unhydrated and the panels
  // show their loading skeleton until /auth/me lands.
  loadFromCache: () => {
    if (get().hydrated) return
    const cached = loadOpsCache()
    if (cached) set({ operations: cached.operations, copyOperations: cached.copyOperations, hydrated: true })
  },

  // As duas listas em paralelo. allSettled em vez de all: se /copy/operations
  // falhar (copy desligado, 500), as ops normais continuam atualizando —
  // o Historico nao pode parar de funcionar por causa do modulo de copy.
  refetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const [rOps, rCopy] = await Promise.allSettled([
        api.get('/operations'),
        api.get('/copy/operations'),
      ])
      if (rOps.status === 'rejected') { set({ loading: false }); return }
      const ops  = rOps.value.data?.operations ?? []
      const copy = rCopy.status === 'fulfilled'
        ? (rCopy.value.data?.operations ?? [])
        : get().copyOperations
      saveOpsCache(ops, copy)
      set({ operations: ops, copyOperations: copy, hydrated: true, loading: false })
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
    saveOpsCache(next, get().copyOperations)
    set({ operations: next })
  },

  reset: () => {
    clearOpsCache()
    set({ operations: [], copyOperations: [], hydrated: false, loading: false })
  },
}))
