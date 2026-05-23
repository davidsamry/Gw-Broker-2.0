'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, ArrowRight, ArrowLeft, KeyRound } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

// Dedicated admin entry. Same /auth/login endpoint behind the scenes, but
// the UI is stripped down (no register, no social login) and explicitly
// admin-themed. The 2FA code field appears in step 2, only after the
// password check returns REQUIRES_2FA.

type Step = 'credentials' | 'twoFactor'

export default function AdminLoginPage() {
  const router = useRouter()
  const login  = useAuthStore((s) => s.login)

  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode]         = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password, step === 'twoFactor' ? code : undefined)
      // Success — let the destination decide if user is actually admin.
      // AdminGuard will redirect to / if not.
      router.replace('/admin')
    } catch (err: any) {
      const errCode = err?.response?.data?.error
      if (errCode === 'REQUIRES_2FA') {
        setStep('twoFactor')
      } else if (errCode === 'INVALID_2FA_CODE') {
        setError('Código inválido. Tente novamente.')
        setCode('')
      } else if (errCode === 'INVALID_CREDENTIALS') {
        setError('E-mail ou senha incorretos.')
      } else if (errCode === 'ACCOUNT_BLOCKED') {
        setError('Conta bloqueada. Entre em contato com o suporte.')
      } else {
        setError('Erro ao entrar. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-[#0b0d12] flex flex-col items-center justify-center overflow-hidden px-4">
      {/* Subtle decorative grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-[400px]">
        {/* Brand header */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mb-3">
            <ShieldCheck size={22} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Admin Panel</h1>
          <p className="text-xs text-[#8b8f9a] mt-1">Acesso restrito · VX Global</p>
        </div>

        <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-6 shadow-2xl shadow-black/40">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {step === 'credentials' ? (
              <>
                <FloatingInput label="E-mail" type="email" value={email} onChange={setEmail} required autoFocus />
                <FloatingInput
                  label="Senha"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  required
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="text-[#8b8f9a] hover:text-white transition-colors text-[10px] font-semibold"
                    >
                      {showPass ? 'OCULTAR' : 'MOSTRAR'}
                    </button>
                  }
                />
              </>
            ) : (
              <>
                <div className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-500/30 rounded-lg px-3 py-3 mb-1">
                  <KeyRound size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-[#ccc] leading-relaxed">
                    Verificação em duas etapas ativada. Digite o código de 6 dígitos
                    do seu aplicativo autenticador.
                  </p>
                </div>
                <FloatingInput
                  label="Código de 6 dígitos"
                  type="text"
                  value={code}
                  onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                  inputMode="numeric"
                  pattern="\d{6}"
                />
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setCode(''); setError('') }}
                  className="flex items-center gap-1.5 text-xs text-[#8b8f9a] hover:text-white transition-colors self-start"
                >
                  <ArrowLeft size={12} />
                  Voltar
                </button>
              </>
            )}

            {error && (
              <p className="text-red-400 text-xs text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || (step === 'twoFactor' && code.length !== 6)}
              className="w-full h-11 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition-all font-bold text-black flex items-center justify-center gap-2 disabled:opacity-50 text-sm mt-1"
            >
              {loading ? '...' : (
                <>
                  {step === 'credentials' ? 'Continuar' : 'Entrar'}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer link back to normal login */}
        <div className="text-center mt-5">
          <Link
            href="/login"
            className="text-xs text-[#8b8f9a] hover:text-white transition-colors"
          >
            Não é admin? <span className="text-emerald-400">Voltar ao login normal</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

function FloatingInput({
  label, type, value, onChange, required, rightIcon, autoFocus, inputMode, pattern,
}: {
  label:      string
  type:       string
  value:      string
  onChange:   (v: string) => void
  required?:  boolean
  rightIcon?: React.ReactNode
  autoFocus?: boolean
  inputMode?: 'text' | 'numeric' | 'email'
  pattern?:   string
}) {
  return (
    <div className="relative">
      <span className="absolute -top-2 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#13161f] z-10">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        inputMode={inputMode}
        pattern={pattern}
        className="w-full bg-transparent border border-[#1f232e] rounded-lg px-3 py-3 pr-20 text-white text-sm outline-none focus:border-emerald-500/60 transition-colors tracking-wider"
      />
      {rightIcon && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightIcon}</div>
      )}
    </div>
  )
}
