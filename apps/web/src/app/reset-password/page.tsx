'use client'

// Reset-password page reached via the link in the recovery email.
// URL: /reset-password?token=<64-hex>
// User types new password (twice), submits, gets bounced to /login.

import { useState, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Lock, Check, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { Logo } from '@/components/layout/Logo'

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams?.get('token') ?? ''

  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [done,    setDone]    = useState(false)

  // Pre-flight: if there's no token in URL, the link is malformed.
  // Render the error state instead of a form that can't possibly submit.
  const noToken = !token || token.length !== 64

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => router.replace('/login'), 3000)
      return () => clearTimeout(t)
    }
  }, [done, router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8)        { setError('A senha deve ter pelo menos 8 caracteres.'); return }
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'TOKEN_INVALID')      setError('Link inválido.')
      else if (code === 'TOKEN_EXPIRED')      setError('Link expirado. Solicite um novo.')
      else if (code === 'TOKEN_USED')         setError('Link já utilizado. Solicite um novo.')
      else if (code === 'PASSWORD_TOO_SHORT') setError('A senha deve ter pelo menos 8 caracteres.')
      else                                     setError('Erro ao redefinir. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex flex-col items-center px-4 py-10">
      <div className="mb-8">
        <Logo size="lg" />
      </div>

      <div className="w-full max-w-sm bg-[#161b27]/90 backdrop-blur rounded-xl border border-white/5 p-6 shadow-2xl">
        {noToken ? (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-4">
              <AlertCircle size={26} className="text-red-400" />
            </div>
            <h1 className="text-white text-lg font-bold mb-2">Link inválido</h1>
            <p className="text-sm text-[#8b8f9a]">
              O link de redefinição parece estar incompleto. Solicite um novo.
            </p>
            <Link href="/forgot-password" className="inline-block mt-5 text-sm text-blue-400 hover:text-blue-300">
              Solicitar novo link
            </Link>
          </div>
        ) : done ? (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4">
              <Check size={28} className="text-emerald-400" />
            </div>
            <h1 className="text-white text-xl font-bold mb-2">Senha redefinida</h1>
            <p className="text-sm text-[#8b8f9a]">
              Pronto! Você será redirecionado para o login em alguns segundos…
            </p>
            <Link href="/login" className="inline-block mt-5 text-sm text-blue-400 hover:text-blue-300">
              Ir para o login agora
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-5">
              <div className="w-14 h-14 mx-auto rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mb-3">
                <Lock size={26} className="text-blue-400" />
              </div>
              <h1 className="text-white text-xl font-bold mb-1">Redefinir senha</h1>
              <p className="text-xs text-[#8b8f9a]">
                Crie uma nova senha com pelo menos 8 caracteres.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <span className="absolute -top-2.5 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#161b27]">Nova senha</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-transparent border border-[#2a2e4a] rounded-lg px-3 py-3 text-white text-sm outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div className="relative">
                <span className="absolute -top-2.5 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#161b27]">Confirmar senha</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full bg-transparent border border-[#2a2e4a] rounded-lg px-3 py-3 text-white text-sm outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {error && <p className="text-red-400 text-xs text-center">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all font-bold text-white text-sm disabled:opacity-50"
              >
                {loading ? '…' : 'Redefinir senha'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
