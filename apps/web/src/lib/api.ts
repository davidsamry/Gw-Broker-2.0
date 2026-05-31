import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ── Storage keys ────────────────────────────────────────────────────────
// Por padrao o token vive em localStorage (persiste entre abas + reload).
// Quando admin "Loga como Usuario", a aba de impersonation salva o token
// em sessionStorage — fica isolada (so aquela aba), preserva a sessao do
// admin na aba original.
const TOKEN_LS = 'token'                  // admin/user normal — localStorage
const TOKEN_SS = 'impersonation_token'    // impersonation — sessionStorage por aba

/** Retorna o token efetivo: sessionStorage tem prioridade quando presente. */
function getEffectiveToken(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(TOKEN_SS) || localStorage.getItem(TOKEN_LS)
}

/** Atualiza o token no storage correto — sessionStorage se impersonando. */
function setEffectiveToken(token: string): void {
  if (typeof window === 'undefined') return
  if (sessionStorage.getItem(TOKEN_SS)) sessionStorage.setItem(TOKEN_SS, token)
  else                                   localStorage.setItem(TOKEN_LS, token)
}

/** Limpa o token efetivo (logout) — remove de ambos os storages por seguranca. */
function clearEffectiveToken(): void {
  if (typeof window === 'undefined') return
  // Se estiver impersonando, "logout" so' encerra a impersonation —
  // o token do admin no localStorage da aba original NAO e' tocado.
  if (sessionStorage.getItem(TOKEN_SS)) {
    sessionStorage.removeItem(TOKEN_SS)
    sessionStorage.removeItem('impersonating')  // flag do banner
    return
  }
  localStorage.removeItem(TOKEN_LS)
}

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = getEffectiveToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    const url      = (original?.url ?? '') as string

    // Auth-attempt endpoints. Their 401s carry domain errors (INVALID_
    // CREDENTIALS / REQUIRES_2FA / INVALID_2FA_CODE / INVALID_REFRESH),
    // NOT "session expired". Routing them through refresh + redirect
    // wipes the LoginPage's local state and bounces the user back to
    // the email/password screen mid-2FA — let the form handle them.
    const isAuthAttempt =
      url.startsWith('/auth/login')    ||
      url.startsWith('/auth/register') ||
      url.startsWith('/auth/refresh')

    if (err.response?.status === 401 && !isAuthAttempt && !original._retry) {
      original._retry = true
      try {
        // Refresh: NAO funciona em modo impersonation (refresh cookie e' do
        // admin, geraria token de admin de volta = bug). Se estamos
        // impersonando e o token expirou, melhor jogar pro login.
        if (typeof window !== 'undefined' && sessionStorage.getItem(TOKEN_SS)) {
          throw new Error('IMPERSONATION_EXPIRED')
        }
        const { data } = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true })
        setEffectiveToken(data.token)
        original.headers.Authorization = `Bearer ${data.token}`
        return api(original)
      } catch {
        clearEffectiveToken()
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

// Export pra outros modulos (auth store, impersonate page, banner) lerem
// no storage correto sem precisar replicar a logica de prioridade.
export { getEffectiveToken, setEffectiveToken, clearEffectiveToken, TOKEN_LS, TOKEN_SS }
