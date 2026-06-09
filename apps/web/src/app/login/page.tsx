'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { Logo } from '@/components/layout/Logo'

const COUNTRIES = [
  'Brasil', 'Portugal', 'Angola', 'Moçambique', 'Cabo Verde',
  'Estados Unidos', 'Reino Unido', 'Alemanha', 'França', 'Espanha',
  'Argentina', 'Chile', 'Colômbia', 'México', 'Peru',
]

// Only BRL accepted at this stage of the rollout. Other currencies were
// listed during early mocks but the deposit (PIX) + payout pipelines are
// BRL-only. Add entries here when those rails support new currencies.
const CURRENCIES = ['BRL']

// Next.js 16 prerender bailout — any client component reading from
// useSearchParams() must live inside a <Suspense> boundary, otherwise
// the static export fails. We wrap the real implementation here.
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0d1117]" />}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  // Initial tab honours ?tab=register so marketing/landing pages can deep-link
  // straight to the signup form. Anything else (or no param) → login.
  const searchParams = useSearchParams()
  const initialTab: 'login' | 'register' =
    searchParams?.get('tab') === 'register' ? 'register' : 'login'
  const [tab, setTab] = useState<'login' | 'register'>(initialTab)
  // Keep state in sync if the URL changes while the page is mounted
  // (e.g. user clicks an in-app link that updates the query string).
  useEffect(() => { setTab(initialTab) }, [initialTab])

  const router = useRouter()
  const login    = useAuthStore(s => s.login)
  const register = useAuthStore(s => s.register)

  // Login
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  // 2FA — populated when the server says REQUIRES_2FA.
  const [twoFA,    setTwoFA]    = useState(false)
  const [code,     setCode]     = useState('')

  // Register — defaults to Brasil + BRL since that's the primary market.
  // User can change both before submitting if registering from elsewhere.
  const [country,    setCountry]    = useState('Brasil')
  const [currency,   setCurrency]   = useState('BRL')
  const [rEmail,     setREmail]     = useState('')
  const [rPassword,  setRPassword]  = useState('')
  const [showRPass,  setShowRPass]  = useState(false)
  // CPF kept as display-formatted string ("000.000.000-00") for the input,
  // stripped to 11 raw digits when sent to the API.
  const [cpf,        setCpf]        = useState('')
  const [terms18,    setTerms18]    = useState(false)
  const [termsNoUS,  setTermsNoUS]  = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [countryOpen,   setCountryOpen]   = useState(false)

  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const filteredCountries = COUNTRIES.filter(c =>
    c.toLowerCase().includes(countrySearch.toLowerCase())
  )

  // Tab switcher that ALSO updates the URL so a copied link reflects
  // the current view. Used by the top tabs + the footer cross-link.
  function switchTab(next: 'login' | 'register') {
    setTab(next)
    setError('')
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (next === 'register') params.set('tab', 'register')
    else params.delete('tab')
    const qs = params.toString()
    router.replace(qs ? `/login?${qs}` : '/login', { scroll: false })
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password, twoFA ? code : undefined)
      // ?next=/admin/foo permite que o AdminGuard (admin tentando acessar
      // /admin/* deslogado) mande direto pra rota desejada — apos logar
      // como user, o admin segue pra /admin/login que faz o step-up 2FA.
      // Sanitiza: so' aceita paths que comecam com /, evitando open-redirect.
      // Default landing after login = /app (a "/" agora e' landing publica).
      const nextRaw = searchParams?.get('next') ?? ''
      const next    = nextRaw.startsWith('/') ? nextRaw : '/app'
      router.replace(next)
    } catch (err: any) {
      const errCode = err.response?.data?.error
      if (errCode === 'REQUIRES_2FA') {
        // Account has 2FA enabled — switch the form to ask for the code.
        setTwoFA(true)
        setCode('')
      } else if (errCode === 'INVALID_2FA_CODE') {
        setError('Código inválido. Tente novamente.')
        setCode('')
      } else if (errCode === 'INVALID_CREDENTIALS') {
        setError('E-mail ou senha incorretos.')
        setTwoFA(false); setCode('')
      } else if (errCode === 'ACCOUNT_BLOCKED') {
        setError('Conta bloqueada. Entre em contato com o suporte.')
      } else if (errCode === 'RATE_LIMITED') {
        const retry = err.response?.data?.retryAfter
        const mins  = retry ? Math.ceil(retry / 60) : null
        setError(
          mins
            ? `Muitas tentativas de login. Tente novamente em ${mins} min.`
            : 'Muitas tentativas. Tente novamente em alguns minutos.',
        )
      } else {
        setError('Erro ao entrar. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!terms18) { setError('Confirme que você tem 18 anos ou mais.'); return }
    if (rPassword.length < 8) { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    const cpfDigits = cpf.replace(/\D/g, '')
    if (cpfDigits.length !== 11) { setError('CPF inválido — preencha os 11 dígitos.'); return }
    setLoading(true)
    try {
      // Use email prefix as name since we don't ask for name
      const name = rEmail.split('@')[0]
      await register(name, rEmail, rPassword, cpfDigits)
      router.replace('/app')
    } catch (err: any) {
      const code = err.response?.data?.error
      if      (code === 'EMAIL_TAKEN') setError('Este e-mail já está em uso.')
      else if (code === 'CPF_TAKEN')   setError('Este CPF já está cadastrado.')
      else if (code === 'VALIDATION_ERROR') setError('CPF inválido. Verifique e tente novamente.')
      else                              setError('Erro ao criar conta. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  // Applies the 000.000.000-00 mask as the user types — strips any non-digit
  // they paste, caps at 11 digits, then re-inserts dots/dash at fixed
  // positions. Stored value is always the masked string; we strip again
  // before submit.
  function maskCpf(raw: string): string {
    const d = raw.replace(/\D/g, '').slice(0, 11)
    let out = d
    if (d.length > 9)  out = `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
    else if (d.length > 6) out = `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
    else if (d.length > 3) out = `${d.slice(0,3)}.${d.slice(3)}`
    return out
  }

  return (
    <div className="relative min-h-screen bg-[#0d1117] flex flex-col overflow-hidden">

      {/* Background chart */}
      <div className="absolute bottom-0 left-0 right-0 h-[55%] pointer-events-none">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#0d1117" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Main wave fill */}
          <path d="M0,180 C60,160 90,200 150,185 C210,170 240,140 300,155 C360,170 390,210 450,195 C510,180 540,150 600,162 C660,174 690,205 750,188 C810,171 840,145 900,158 C960,171 990,200 1050,185 C1110,170 1140,148 1200,160 C1260,172 1290,198 1350,182 C1380,174 1410,165 1440,170 L1440,320 L0,320 Z" fill="url(#g1)" />
          {/* Line */}
          <path d="M0,180 C60,160 90,200 150,185 C210,170 240,140 300,155 C360,170 390,210 450,195 C510,180 540,150 600,162 C660,174 690,205 750,188 C810,171 840,145 900,158 C960,171 990,200 1050,185 C1110,170 1140,148 1200,160 C1260,172 1290,198 1350,182 C1380,174 1410,165 1440,170" fill="none" stroke="#1e6fa8" strokeWidth="1.5" opacity="0.7" />
          {/* Second wave */}
          <path d="M0,220 C80,205 120,235 200,218 C280,201 320,175 400,190 C480,205 520,230 600,215 C680,200 720,178 800,192 C880,206 920,228 1000,212 C1080,196 1120,175 1200,188 C1280,201 1320,222 1440,208 L1440,320 L0,320 Z" fill="#1a2a3a" opacity="0.3" />
          <path d="M0,220 C80,205 120,235 200,218 C280,201 320,175 400,190 C480,205 520,230 600,215 C680,200 720,178 800,192 C880,206 920,228 1000,212 C1080,196 1120,175 1200,188 C1280,201 1320,222 1440,208" fill="none" stroke="#1e4a6a" strokeWidth="1" opacity="0.5" />
        </svg>
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-center py-5 border-b border-white/5">
        <Logo size="lg" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-start pt-8 px-4">
        <h1 className="text-white text-2xl font-bold mb-6">
          {tab === 'login' ? 'Conecte-se' : 'Inscrever-se'}
        </h1>

        <div className="w-full max-w-sm bg-[#161b27]/90 backdrop-blur rounded-xl overflow-visible shadow-2xl border border-white/5">

          {/* Tabs */}
          <div className="flex border-b border-white/10">
            <button
              onClick={() => switchTab('login')}
              className={`flex-1 py-3.5 text-sm font-semibold transition-colors rounded-tl-xl ${
                tab === 'login' ? 'bg-[#1e2535] text-white' : 'text-[#8b8f9a] hover:text-white'
              }`}
            >
              Entrar
            </button>
            <button
              onClick={() => switchTab('register')}
              className={`flex-1 py-3.5 text-sm font-semibold transition-colors rounded-tr-xl ${
                tab === 'register' ? 'bg-[#1e2535] text-white' : 'text-[#8b8f9a] hover:text-white'
              }`}
            >
              Cadastro
            </button>
          </div>

          <div className="p-6">
            {tab === 'login' ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {twoFA ? (
                  <>
                    <div className="text-center mb-1">
                      <p className="text-sm font-semibold text-white">Verificação em 2 etapas</p>
                      <p className="text-xs text-[#8b8f9a] mt-1">
                        Digite o código de 6 dígitos do seu app autenticador
                      </p>
                    </div>
                    <input
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="w-full bg-transparent border border-[#2a2e4a] rounded-lg px-3 py-3 text-center text-xl font-mono text-white outline-none focus:border-blue-500 transition-colors tracking-[0.5em]"
                    />
                    <button
                      type="button"
                      onClick={() => { setTwoFA(false); setCode(''); setError('') }}
                      className="text-xs text-[#8b8f9a] hover:text-white transition-colors self-center"
                    >
                      ← Usar outro e-mail
                    </button>
                  </>
                ) : (
                  <>
                    <FloatingInput label="E-mail" type="email" value={email} onChange={setEmail} required />
                    <FloatingInput label="Senha" type={showPass ? 'text' : 'password'} value={password} onChange={setPassword} required
                      rightIcon={<EyeIcon show={showPass} onClick={() => setShowPass(v => !v)} />}
                    />

                    <div className="flex items-center justify-between text-xs">
                      <label className="flex items-center gap-2 text-[#8b8f9a] cursor-pointer select-none">
                        <input type="checkbox" className="accent-blue-500 w-3.5 h-3.5" />
                        Lembrar-me
                      </label>
                      <button
                        type="button"
                        onClick={() => router.push('/forgot-password')}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Esqueceu sua senha?
                      </button>
                    </div>
                  </>
                )}

                {error && <p className="text-red-400 text-xs text-center">{error}</p>}

                <SubmitButton loading={loading} label={twoFA ? 'Verificar' : 'Entrar'} />
              </form>
            ) : (
              <form onSubmit={handleRegister} className="flex flex-col gap-4">

                {/* Country selector */}
                <div className="relative">
                  <div
                    onClick={() => setCountryOpen(v => !v)}
                    className="relative border border-[#2a2e4a] rounded-lg px-3 py-3 cursor-pointer flex items-center justify-between"
                  >
                    <span className="absolute -top-2.5 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#161b27]">País / Região de residência</span>
                    <div className="flex items-center gap-2">
                      <span className="text-base">🌐</span>
                      <span className={`text-sm ${country ? 'text-white' : 'text-[#8b8f9a]'}`}>{country || 'Procurar'}</span>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f9a" strokeWidth="2" className={`transition-transform ${countryOpen ? 'rotate-180' : ''}`}>
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </div>
                  {countryOpen && (
                    <div className="absolute top-full left-0 right-0 z-50 bg-[#1e2535] border border-[#2a2e4a] rounded-lg mt-1 shadow-xl overflow-hidden">
                      <div className="p-2">
                        <input
                          autoFocus
                          value={countrySearch}
                          onChange={e => setCountrySearch(e.target.value)}
                          placeholder="Procurar país..."
                          className="w-full bg-[#252a3a] border border-[#2a2e4a] rounded px-3 py-2 text-white text-sm outline-none"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {filteredCountries.map(c => (
                          <button key={c} type="button"
                            onClick={() => { setCountry(c); setCountryOpen(false); setCountrySearch('') }}
                            className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 transition-colors"
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Currency */}
                <div className="relative">
                  <span className="absolute -top-2.5 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#161b27] z-10">Moeda</span>
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="w-full bg-transparent border border-[#2a2e4a] rounded-lg px-3 py-3 text-white text-sm outline-none appearance-none cursor-pointer"
                  >
                    {CURRENCIES.map(c => <option key={c} value={c} className="bg-[#1e2535]">{c}</option>)}
                  </select>
                  <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f9a" strokeWidth="2">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>

                {/* CPF — placed FIRST among credential fields. KYC-anchor
                    of the account; the live mask shows BR-resident users
                    they're in the right form before they bother typing
                    email/password. Mask is applied as they type; submit
                    strips back to 11 raw digits. inputMode='numeric'
                    opens the digit keypad on mobile; maxLength=14 caps
                    at the formatted length. */}
                <FloatingInput
                  label="CPF"
                  type="text"
                  value={cpf}
                  onChange={(v) => setCpf(maskCpf(v))}
                  required
                  inputMode="numeric"
                  maxLength={14}
                />
                <FloatingInput label="E-mail" type="email" value={rEmail} onChange={setREmail} required />
                <FloatingInput label="Senha" type={showRPass ? 'text' : 'password'} value={rPassword} onChange={setRPassword} required
                  rightIcon={<EyeIcon show={showRPass} onClick={() => setShowRPass(v => !v)} />}
                />

                {/* Checkboxes */}
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={terms18} onChange={e => setTerms18(e.target.checked)}
                    className="accent-blue-500 w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span className="text-[11px] text-[#8b8f9a] leading-relaxed">
                    Confirmo que tenho 18 anos ou mais e aceito o{' '}
                    <span className="text-blue-400">Acordo de Serviço</span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={termsNoUS} onChange={e => setTermsNoUS(e.target.checked)}
                    className="accent-blue-500 w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span className="text-[11px] text-[#8b8f9a] leading-relaxed">
                    Declaro e confirmo que não sou cidadão ou residente dos EUA para fins fiscais
                  </span>
                </label>

                {error && <p className="text-red-400 text-xs text-center">{error}</p>}

                <SubmitButton loading={loading} label="Cadastro" />
              </form>
            )}

            {/* Social divider */}
            <div className="flex items-center gap-3 mt-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-[#8b8f9a]">Entrar com</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <div className="flex justify-center mt-3">
              <button type="button" className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </button>
            </div>

            {/* Cross-link to the other tab — prominent below the social row
                so first-time visitors who only see "Entrar" know they can
                also create an account here (and vice-versa). Same handler
                as the top tabs so URL stays in sync. */}
            <div className="mt-5 pt-4 border-t border-white/10 text-center">
              {tab === 'login' ? (
                <p className="text-xs text-[#8b8f9a]">
                  Não tem conta?{' '}
                  <button
                    type="button"
                    onClick={() => switchTab('register')}
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Cadastre-se aqui
                  </button>
                </p>
              ) : (
                <p className="text-xs text-[#8b8f9a]">
                  Já tem conta?{' '}
                  <button
                    type="button"
                    onClick={() => switchTab('login')}
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Fazer login
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FloatingInput({ label, type, value, onChange, required, rightIcon, inputMode, maxLength }: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  rightIcon?: React.ReactNode
  /** Mobile keyboard hint — 'numeric' for CPF/phone, 'email' on email, etc. */
  inputMode?: 'numeric' | 'tel' | 'email' | 'decimal' | 'text'
  maxLength?: number
}) {
  return (
    <div className="relative">
      <span className="absolute -top-2.5 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#161b27] z-10">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
        className="w-full bg-transparent border border-[#2a2e4a] rounded-lg px-3 py-3 pr-10 text-white text-sm outline-none focus:border-blue-500 transition-colors"
      />
      {rightIcon && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightIcon}</div>
      )}
    </div>
  )
}

function EyeIcon({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[#8b8f9a] hover:text-white transition-colors">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {show
          ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
          : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
        }
      </svg>
    </button>
  )
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm mt-1"
    >
      {loading ? '...' : (
        <>
          {label}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/><path d="M12 8l4 4-4 4M8 12h8"/>
          </svg>
        </>
      )}
    </button>
  )
}
