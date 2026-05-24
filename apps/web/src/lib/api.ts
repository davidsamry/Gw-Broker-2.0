import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
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
        const { data } = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true })
        localStorage.setItem('token', data.token)
        original.headers.Authorization = `Bearer ${data.token}`
        return api(original)
      } catch {
        localStorage.removeItem('token')
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)
