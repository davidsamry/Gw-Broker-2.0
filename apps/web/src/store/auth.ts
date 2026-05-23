import { create } from 'zustand'
import { api } from '@/lib/api'
import { useOperationsStore } from './operations'
import { useWithdrawalsStore } from './withdrawals'
import { useTransactionsStore } from './transactions'

export interface Account {
  id:       string
  type:     'DEMO' | 'REAL'
  balance:  string
  currency: string
}

export type UserRole = 'USER' | 'ADMIN'

export interface User {
  id:         string
  name:       string
  email:      string
  kycStatus:  string
  role:       UserRole
  accounts:   Account[]
  // Optional profile fields populated by the Minha Conta form.
  nickname?:  string | null
  lastName?:  string | null
  birthDate?: string | null  // ISO date "YYYY-MM-DD"
  cpf?:       string | null
  phone?:     string | null
  country?:   string | null
  address?:   string | null
  updatedAt?: string         // used to re-sync MinhaContaTab local state
}

interface AuthState {
  user:               User | null
  token:              string | null
  isDemo:             boolean
  loading:            boolean

  login:              (email: string, password: string) => Promise<void>
  register:           (name: string, email: string, password: string) => Promise<void>
  logout:             () => Promise<void>
  init:               () => Promise<void>
  setIsDemo:          (v: boolean) => void
  refreshAccounts:    () => Promise<void>
  resetDemo:          () => Promise<void>
  applyBalanceDelta:  (accountId: string, delta: number) => void
}

// ── User cache (localStorage) ─────────────────────────────────────────────────
// Persists the User object across reloads so the app can render balance
// immediately (0 RTT) instead of waiting for /auth/me. Server is still the
// source of truth — init() fires /auth/me in the background to revalidate.

// Bump the cache key whenever the User shape changes so existing clients
// don't read a stale cached object missing new fields. Current schema
// version: v2 (added role).
const USER_CACHE_KEY = 'vx_user_cache_v2'
const USER_CACHE_TTL = 5 * 60 * 1000 // 5 min — short enough that stale balance corrects quickly

interface UserCache { user: User; savedAt: number }

function loadUserCache(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UserCache
    if (Date.now() - parsed.savedAt > USER_CACHE_TTL) return null
    return parsed.user ?? null
  } catch {
    return null
  }
}

function saveUserCache(user: User | null) {
  if (typeof window === 'undefined') return
  if (!user) { localStorage.removeItem(USER_CACHE_KEY); return }
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ user, savedAt: Date.now() }))
  } catch { /* quota / private mode — ignore */ }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:    null,
  token:   null,
  isDemo:  true,
  loading: true,

  setIsDemo: (v) => set({ isDemo: v }),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('token', data.token)
    saveUserCache(data.user)
    set({ user: data.user, token: data.token })
  },

  register: async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password })
    localStorage.setItem('token', data.token)
    saveUserCache(data.user)
    set({ user: data.user, token: data.token })
  },

  logout: async () => {
    await api.post('/auth/logout').catch(() => {})
    localStorage.removeItem('token')
    saveUserCache(null)
    set({ user: null, token: null })
    useOperationsStore.getState().reset()
    useWithdrawalsStore.getState().reset()
    useTransactionsStore.getState().reset()
  },

  init: async () => {
    const token = localStorage.getItem('token')
    if (!token) { set({ loading: false }); return }

    // ── Stale-while-revalidate ───────────────────────────────────────────────
    // 1. Hydrate from cache immediately (0 RTT) so the user sees their balance
    //    on screen as soon as the JS bundle parses.
    // 2. Always revalidate against /auth/me in the background — server is the
    //    source of truth. Fresh data replaces the cache silently.
    const cachedUser = get().user ?? loadUserCache()
    if (cachedUser) {
      set({ user: cachedUser, token, loading: false })
    }

    try {
      const { data } = await api.get('/auth/me')
      saveUserCache(data.user)
      set({ user: data.user, token, loading: false })
      // Hydrate operations + withdrawals caches from the same response —
      // eliminates the separate RTTs the panels used to fire on mount.
      if (Array.isArray(data.operations)) {
        useOperationsStore.getState().hydrate(data.operations)
      }
      if (Array.isArray(data.withdrawals)) {
        useWithdrawalsStore.getState().hydrate(data.withdrawals)
      }
      if (Array.isArray(data.transactions)) {
        useTransactionsStore.getState().hydrate(data.transactions)
      }
    } catch {
      // Only blow away cache if we definitely heard a 401 — network errors
      // (which the axios interceptor already redirects to /login on 401)
      // shouldn't trash the cached user.
      if (!cachedUser) {
        localStorage.removeItem('token')
        saveUserCache(null)
        set({ user: null, loading: false })
        useOperationsStore.getState().reset()
        useWithdrawalsStore.getState().reset()
        useTransactionsStore.getState().reset()
      }
    }
  },

  refreshAccounts: async () => {
    const { data } = await api.get('/accounts')
    const user = get().user
    if (!user) return
    const next = { ...user, accounts: data.accounts }
    saveUserCache(next)
    set({ user: next })
  },

  resetDemo: async () => {
    await api.post('/accounts/demo/reset')
    await get().refreshAccounts()
  },

  // Mutate a single account's balance in place — used after a trade resolves
  // so the UI updates instantly without paying a /accounts RTT. Server stays
  // the source of truth (next /auth/me revalidate reconciles any drift).
  applyBalanceDelta: (accountId, delta) => {
    const user = get().user
    if (!user) return
    const accounts = user.accounts.map((a) => {
      if (a.id !== accountId) return a
      const current = parseFloat(a.balance) || 0
      const next    = Math.max(0, current + delta)
      return { ...a, balance: next.toFixed(2) }
    })
    const nextUser = { ...user, accounts }
    saveUserCache(nextUser)
    set({ user: nextUser })
  },
}))

export function useCurrentAccount(state: AuthState) {
  const accounts = state.user?.accounts ?? []
  return state.isDemo
    ? accounts.find(a => a.type === 'DEMO')
    : accounts.find(a => a.type === 'REAL')
}
