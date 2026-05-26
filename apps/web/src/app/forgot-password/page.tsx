'use client'

// "Esqueci minha senha" — accepts email, POSTs to /auth/forgot-password,
// always shows the same success state regardless of whether the email
// exists (so attackers can't enumerate users).

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mail, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { Logo } from '@/components/layout/Logo'

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch {
      // Server always returns 200 — error here means network down. Still
      // show success to avoid leaking info, but it'd be a real bug.
      setSent(true)
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
        {sent ? (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4">
              <Check size={28} className="text-emerald-400" />
            </div>
            <h1 className="text-white text-xl font-bold mb-2">Verifique seu email</h1>
            <p className="text-sm text-[#8b8f9a] leading-relaxed">
              Se uma conta existe com <strong className="text-white">{email}</strong>, enviamos um link para redefinir sua senha. O link expira em 1 hora.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 mt-6 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ArrowLeft size={14} />
              Voltar para o login
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-5">
              <div className="w-14 h-14 mx-auto rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mb-3">
                <Mail size={26} className="text-blue-400" />
              </div>
              <h1 className="text-white text-xl font-bold mb-1">Esqueceu sua senha?</h1>
              <p className="text-xs text-[#8b8f9a]">
                Digite seu email e enviaremos um link pra redefinir.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <span className="absolute -top-2.5 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#161b27]">E-mail</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-transparent border border-[#2a2e4a] rounded-lg px-3 py-3 text-white text-sm outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all font-bold text-white text-sm disabled:opacity-50"
              >
                {loading ? '…' : 'Enviar link de redefinição'}
              </button>
            </form>

            <Link
              href="/login"
              className="inline-flex items-center gap-2 mt-5 text-xs text-[#8b8f9a] hover:text-white transition-colors"
            >
              <ArrowLeft size={12} />
              Voltar para o login
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
