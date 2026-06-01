import { create } from 'zustand'
import { api, getEffectiveToken, setEffectiveToken, clearEffectiveToken } from '@/lib/api'
import { useOperationsStore } from './operations'
import { useWithdrawalsStore } from './withdrawals'
import { useTransactionsStore } from './transactions'
import { useTicketsStore } from './tickets'

export interface Account {
  id:       string
  type:     'DEMO' | 'REAL'
  balance:  string
  currency: string
  // Rollover state — server returns string-encoded Decimals on every
  // /auth/me. Used by the Retirada modal to surface "faltam R$ X" before
  // the user even hits Submit. Both fields are optional because older
  // cached payloads (vx_user_cache_v4 from before this feature) won't
  // have them — the modal falls back to 0 in that case.
  rolloverRequired?: string
  rolloverProgress?: string
  bonusBalance?:     string
}

export type UserRole = 'USER' | 'ADMIN'

export type KycStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface KycSubmission {
  id:          string
  status:      KycStatus
  reason:      string | null
  submittedAt: string
  reviewedAt:  string | null
}

export interface User {
  id:                string
  name:              string
  email:             string
  kycStatus:         string
  role:              UserRole
  twoFactorEnabled:  boolean
  accounts:          Account[]
  // Optional profile fields populated by the Minha Conta form.
  nickname?:         string | null
  lastName?:         string | null
  birthDate?:        string | null  // ISO date "YYYY-MM-DD"
  cpf?:              string | null
  phone?:            string | null
  country?:          string | null
  address?:          string | null
  updatedAt?:        string         // used to re-sync MinhaContaTab local state
  // Per-user market gates (admin /admin/usuarios). Backend enforces;
  // frontend uses these to hide trade buttons + show "Mercado Fechado".
  // Optional in the type so older cached payloads don't break — readers
  // fall back to "allowed" when missing.
  canTradeForex?:    boolean
  canTradeOtc?:      boolean
  canTradeCrypto?:   boolean
}

// Subset of PlatformSettings (api/src/settings/service.ts) exposed publicly
// via /auth/me so the deposit/withdraw/trade forms can read live limits
// instead of hardcoded constants.
export interface PublicSettings {
  depositMin:             number
  depositMax:             number
  withdrawalMin:          number
  withdrawalMax:          number
  withdrawalFeePct:       number
  operationMin:           number
  operationMax:           number
  operationMinIntervalMs: number
  copyTradeEnabled:       boolean
  safeModeEnabled:        boolean
}

// Safe fallbacks for the brief window before /auth/me lands (or when
// running offline). Mirror the defaults seeded in the migration.
export const SETTINGS_FALLBACK: PublicSettings = {
  depositMin:             60,
  depositMax:             100_000,
  withdrawalMin:          60,
  withdrawalMax:          10_000,
  withdrawalFeePct:       0,
  operationMin:           5,
  operationMax:           100_000,
  operationMinIntervalMs: 1000,
  copyTradeEnabled:       true,
  safeModeEnabled:        false,
}

interface AuthState {
  user:               User | null
  token:              string | null
  isDemo:             boolean
  loading:            boolean
  kycSubmission:      KycSubmission | null
  /** Broker-wide limits + toggles. Null only during the very first paint
   *  before /auth/me resolves; readers should use SETTINGS_FALLBACK then. */
  settings:           PublicSettings | null

  // 2FA: pass `code` for users with twoFactorEnabled. If omitted and the
  // account has 2FA on, the API throws REQUIRES_2FA — callers can catch
  // and re-prompt.
  login:              (email: string, password: string, code?: string) => Promise<void>
  /** CPF is required as of 2026-05-26 — 11 raw digits (no mask). Caller
   *  is responsible for stripping `.` and `-` before invocation. */
  register:           (name: string, email: string, password: string, cpf: string) => Promise<void>
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
// version: v6 (added bonusBalance/rolloverRequired/rolloverProgress no
// /auth/me — commit 8c766ad. Clientes em v5 nao tinham esses campos
// no cache mesmo apos a API enviar, ate o TTL de 5min expirar).
const USER_CACHE_KEY = 'vx_user_cache_v6'
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

// ── isDemo preference (localStorage) ──────────────────────────────────────
// Persist the last-selected account type across page reloads so the user
// doesn't get bounced back to DEMO every time they refresh. Defaults to
// DEMO for first-time visitors (safest — no real money at risk).
const IS_DEMO_KEY = 'vx_is_demo'

function loadIsDemo(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = localStorage.getItem(IS_DEMO_KEY)
    if (raw === 'false') return false
    if (raw === 'true')  return true
    return true  // never set → default DEMO
  } catch {
    return true
  }
}

function saveIsDemo(v: boolean) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(IS_DEMO_KEY, String(v)) } catch { /* ignore */ }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:          null,
  token:         null,
  isDemo:        loadIsDemo(),
  loading:       true,
  kycSubmission: null,
  settings:      null,

  setIsDemo: (v) => { saveIsDemo(v); set({ isDemo: v }) },

  login: async (email, password, code) => {
    const payload: { email: string; password: string; code?: string } = { email, password }
    if (code) payload.code = code
    const { data } = await api.post('/auth/login', payload)
    // Login NORMAL — sempre salva em localStorage (persiste entre abas/reload).
    // Mesmo se a aba estiver em "modo impersonation", login explicito de
    // user/admin tem precedencia: limpa o flag e usa localStorage.
    sessionStorage.removeItem('impersonation_token')
    sessionStorage.removeItem('impersonating')
    localStorage.setItem('token', data.token)
    saveUserCache(data.user)
    set({ user: data.user, token: data.token })
  },

  register: async (name, email, password, cpf) => {
    // Attach Meta attribution captured from the landing page / current
    // URL (fbp/fbc cookies + utm_* query params). Backend persists it in
    // user_tracking and uses it on the CompleteRegistration Conversions
    // API event. NEVER throw from this — register must succeed even if
    // the metaTracking module is broken or window unavailable.
    let tracking: Record<string, unknown> | undefined
    try {
      const { captureMetaTracking } = await import('@/lib/metaTracking')
      tracking = captureMetaTracking() as Record<string, unknown>
    } catch { /* swallow — attribution is best-effort */ }
    const { data } = await api.post('/auth/register', { name, email, password, cpf, tracking })
    localStorage.setItem('token', data.token)
    saveUserCache(data.user)
    set({ user: data.user, token: data.token })
  },

  logout: async () => {
    // Se estiver em modo impersonation: NAO chama /auth/logout (que
    // invalida o refresh cookie do admin) e NAO limpa o localStorage do
    // admin. Apenas remove o token de impersonation desta aba. Admin
    // pode fechar a aba e sua sessao na aba original continua valida.
    if (typeof window !== 'undefined' && sessionStorage.getItem('impersonation_token')) {
      sessionStorage.removeItem('impersonation_token')
      sessionStorage.removeItem('impersonating')
      // Limpa o store em memoria — a aba ja nao tem sessao impersonation.
      set({ user: null, token: null, kycSubmission: null, isDemo: true })
      // window.location pra forcar reload completo (limpa qualquer state
      // residual e leva pra tela de login)
      window.location.href = '/login'
      return
    }
    await api.post('/auth/logout').catch(() => {})
    localStorage.removeItem('token')
    localStorage.removeItem(IS_DEMO_KEY)  // next account can be a different user
    // Clear the "welcome bonus shown" flag so the NEXT login (even in
    // the same browser tab) sees the promo modal again.
    try { sessionStorage.removeItem('vx_welcome_bonus_seen') } catch { /* private mode */ }
    saveUserCache(null)
    set({ user: null, token: null, kycSubmission: null, isDemo: true })
    useOperationsStore.getState().reset()
    useWithdrawalsStore.getState().reset()
    useTransactionsStore.getState().reset()
    useTicketsStore.getState().reset()
  },

  init: async () => {
    // Prioridade: token de impersonation (sessionStorage, por aba) > token
    // do admin/user normal (localStorage). Quando admin "Loga como Usuario"
    // numa nova aba, essa aba ve so o sessionStorage e renderiza como user.
    const token = getEffectiveToken()
    if (!token) { set({ loading: false }); return }

    // ── Stale-while-revalidate ───────────────────────────────────────────────
    // 1. Hydrate from cache immediately (0 RTT) so the user sees their balance
    //    + last-seen operations on screen as soon as the JS bundle parses.
    // 2. Always revalidate against /auth/me in the background — server is the
    //    source of truth. Fresh data replaces the cache silently.
    const cachedUser = get().user ?? loadUserCache()
    if (cachedUser) {
      set({ user: cachedUser, token, loading: false })
    }
    // Also restore operations / withdrawals / transactions caches so the
    // FECHADAS list + Histórico + Retirada + Transações tabs all paint
    // instantly. Same SWR contract — /auth/me below overwrites on success.
    useOperationsStore.getState().loadFromCache()
    useWithdrawalsStore.getState().loadFromCache()
    useTransactionsStore.getState().loadFromCache()

    try {
      const { data } = await api.get('/auth/me')
      saveUserCache(data.user)
      set({
        user:     data.user,
        token,
        loading:  false,
        // Capture the live PlatformSettings snapshot. Falsy/missing →
        // keep whatever was previously cached (don't blow it away).
        ...(data.settings ? { settings: data.settings as PublicSettings } : {}),
      })
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
      set({ kycSubmission: data.kycSubmission ?? null })
    } catch {
      // Only blow away cache if we definitely heard a 401 — network errors
      // (which the axios interceptor already redirects to /login on 401)
      // shouldn't trash the cached user.
      if (!cachedUser) {
        clearEffectiveToken()
        saveUserCache(null)
        set({ user: null, loading: false })
        useOperationsStore.getState().reset()
        useWithdrawalsStore.getState().reset()
        useTransactionsStore.getState().reset()
        useTicketsStore.getState().reset()
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
  //
  // 2026-05-31: SPLIT balance + bonus. Espelha a logica do backend
  // (createOperation CTE): debita do balance principal primeiro, restante
  // sai do bonus. Credits (win/refund/deposit) vao TODOS pro balance —
  // user "promove" bonus pra saldo real ao ganhar com ele, ou no pior
  // caso recupera valor no balance (refund leve a favor do user).
  applyBalanceDelta: (accountId, delta) => {
    const user = get().user
    if (!user) return

    // Defesa contra cache local stale: se o debito (delta<0) excede o
    // balance+bonus visivel localmente, NAO atualiza otimisticamente —
    // disparam /auth/me em background pra reconciliar com o servidor.
    // Sem isso, cache antigo (sem bonusBalance) causava "saldo zera
    // visualmente" no clique do trade, mesmo o servidor tendo aceitado.
    const target = user.accounts.find((a) => a.id === accountId)
    if (target && delta < 0) {
      const balance = parseFloat(target.balance) || 0
      const bonus   = parseFloat(target.bonusBalance ?? '0') || 0
      const need    = -delta
      if (need > balance + bonus + 0.01) {  // margem 1c pra arredondamento
        // Skip otimista — local out-of-sync. Force refetch e deixa o
        // proximo /auth/me popular o saldo correto.
        api.get('/auth/me').then((res) => {
          const fresh = res.data?.user
          if (fresh) {
            saveUserCache(fresh)
            set({ user: fresh })
          }
        }).catch(() => { /* ignore — interceptor cuida */ })
        return
      }
    }

    const accounts = user.accounts.map((a) => {
      if (a.id !== accountId) return a
      const balance = parseFloat(a.balance)      || 0
      const bonus   = parseFloat(a.bonusBalance ?? '0') || 0

      if (delta >= 0) {
        // Credito (win, refund, deposito) — tudo vai pro balance principal
        return { ...a, balance: (balance + delta).toFixed(2) }
      }

      // Debito (stake do trade): balance primeiro, restante do bonus.
      const need        = -delta
      const balanceDeb  = Math.min(balance, need)
      const bonusDeb    = need - balanceDeb
      return {
        ...a,
        balance:      (balance - balanceDeb).toFixed(2),
        bonusBalance: Math.max(0, bonus - bonusDeb).toFixed(2),
      }
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
