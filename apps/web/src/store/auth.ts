import { create } from 'zustand'
import { api } from '@/lib/api'

export interface Account {
  id:       string
  type:     'DEMO' | 'REAL'
  balance:  string
  currency: string
}

export interface User {
  id:        string
  name:      string
  email:     string
  kycStatus: string
  accounts:  Account[]
}

interface AuthState {
  user:     User | null
  token:    string | null
  isDemo:   boolean
  loading:  boolean

  login:           (email: string, password: string) => Promise<void>
  register:        (name: string, email: string, password: string) => Promise<void>
  logout:          () => Promise<void>
  init:            () => Promise<void>
  setIsDemo:       (v: boolean) => void
  refreshAccounts: () => Promise<void>
  resetDemo:       () => Promise<void>
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
    set({ user: data.user, token: data.token })
  },

  register: async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password })
    localStorage.setItem('token', data.token)
    set({ user: data.user, token: data.token })
  },

  logout: async () => {
    await api.post('/auth/logout').catch(() => {})
    localStorage.removeItem('token')
    set({ user: null, token: null })
  },

  init: async () => {
    const token = localStorage.getItem('token')
    if (!token) { set({ loading: false }); return }
    try {
      const { data } = await api.get('/auth/me')
      set({ user: data.user, token, loading: false })
    } catch {
      localStorage.removeItem('token')
      set({ loading: false })
    }
  },

  refreshAccounts: async () => {
    const { data } = await api.get('/accounts')
    const user = get().user
    if (!user) return
    set({ user: { ...user, accounts: data.accounts } })
  },

  resetDemo: async () => {
    await api.post('/accounts/demo/reset')
    await get().refreshAccounts()
  },
}))

export function useCurrentAccount(state: AuthState) {
  const accounts = state.user?.accounts ?? []
  return state.isDemo
    ? accounts.find(a => a.type === 'DEMO')
    : accounts.find(a => a.type === 'REAL')
}
