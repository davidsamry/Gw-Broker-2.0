'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, ArrowRight, KeyRound, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { api } from '@/lib/api'

// 2026-06-01: Refeito como pagina de STEP-UP 2FA — nao mais um login
// separado. Fluxo:
//
//   1. Admin loga em /login normalmente (com email + senha, SEM 2FA).
//      Recebe token "trader mode" e ja' renderiza a plataforma como user.
//   2. Quando clica em entrar no admin, e' redirecionado pra ca.
//   3. Aqui ele digita o code 2FA. POST /auth/admin-step-up troca o token
//      por um novo com claim adminAuth=true. Redireciona pra /admin.
//   4. requireAdmin no backend exige essa claim — token sem ela e' 403.
//
// Sem login aqui — se admin chegou nesta pagina deslogado, e' mandado
// pra /login primeiro. Mesma logica se ele e' user comum (nao admin).
export default function AdminStepUpPage() {
  const router  = useRouter()
  const user    = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)

  const [code, setCode]           = useState('')
  const [error, setError]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(true)
  // trustChecking: true durante a tentativa automatica de step-up via
  // trust-device cookie. Mostra loader em vez do form pra evitar flash.
  const [trustChecking, setTrustChecking] = useState(true)

  // Guards: se nao logado → /login. Se logado mas nao admin → /.
  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/login?next=/admin/login'); return }
    if (user.role !== 'ADMIN') { router.replace('/'); return }
  }, [user, loading, router])

  // Tenta step-up automatico via trust-device cookie. Se o user ja' marcou
  // "lembrar este dispositivo" antes, o cookie httpOnly vai junto via
  // withCredentials e o backend emite um token novo com adminAuth=true.
  // Em sucesso: redireciona direto pro painel. Em falha: mostra o form
  // de code normalmente.
  useEffect(() => {
    if (loading || !user || user.role !== 'ADMIN') return
    let cancelled = false
    api.post('/auth/admin-step-up-trusted', {})
      .then((res) => {
        if (cancelled) return
        const newTok = res.data?.token
        if (newTok) {
          localStorage.setItem('token', newTok)
          useAuthStore.setState({ token: newTok })
          router.replace('/admin')
        } else {
          setTrustChecking(false)
        }
      })
      .catch(() => { if (!cancelled) setTrustChecking(false) })
    return () => { cancelled = true }
  }, [user, loading, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setError('')
    setSubmitting(true)
    try {
      const { data } = await api.post('/auth/admin-step-up', { code, rememberDevice })
      // Substitui o token no localStorage (e zustand state). Sessao de
      // refresh-cookie nao muda — so' o access token recebe a claim.
      if (data?.token) {
        localStorage.setItem('token', data.token)
        useAuthStore.setState({ token: data.token })
      }
      router.replace('/admin')
    } catch (err: any) {
      const errCode = err?.response?.data?.error
      if (errCode === 'INVALID_2FA_CODE') {
        setError('Código inválido. Tente novamente.')
        setCode('')
      } else if (errCode === 'NOT_ADMIN') {
        setError('Sua conta não tem permissão de admin.')
      } else if (errCode === 'TWO_FACTOR_NOT_ENABLED') {
        setError('2FA não configurado — configure antes de continuar.')
        setTimeout(() => router.replace('/admin/setup-2fa'), 1500)
      } else if (errCode === 'RATE_LIMITED') {
        const retry = err.response?.data?.retryAfter
        const mins  = retry ? Math.ceil(retry / 60) : null
        setError(mins ? `Muitas tentativas. Tente em ${mins}min.` : 'Muitas tentativas.')
      } else {
        setError('Erro ao verificar código.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Loading state — auth init em andamento OU tentando trust automatico.
  // Evita flash do form de codigo pra users com cookie valido.
  if (loading || !user || trustChecking) {
    return (
      <div className="min-h-screen bg-[#0b0d12] flex items-center justify-center">
        <Loader2 size={28} className="text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#0b0d12] flex flex-col items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mb-3">
            <ShieldCheck size={22} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Verificação 2FA</h1>
          <p className="text-xs text-[#8b8f9a] mt-1">
            Logado como <span className="text-white">{user.email}</span>
          </p>
        </div>

        <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-6 shadow-2xl shadow-black/40">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-500/30 rounded-lg px-3 py-3 mb-1">
              <KeyRound size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#ccc] leading-relaxed">
                Digite o código de 6 dígitos do app autenticador pra acessar
                o painel administrativo.
              </p>
            </div>
            <div className="relative">
              <span className="absolute -top-2 left-3 px-1 text-[10px] text-[#8b8f9a] bg-[#13161f] z-10">
                Código de 6 dígitos
              </span>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                inputMode="numeric"
                pattern="\d{6}"
                className="w-full bg-transparent border border-[#1f232e] rounded-lg px-3 py-3 text-white text-sm outline-none focus:border-emerald-500/60 transition-colors tracking-[0.4em] text-center font-mono text-lg"
              />
            </div>

            {/* Trust device — pula 2FA nas proximas vezes nesse browser. */}
            <label className="flex items-center gap-2 text-xs text-[#8b8f9a] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="accent-emerald-500 w-3.5 h-3.5"
              />
              Confiar neste dispositivo por 30 dias
            </label>

            {error && <p className="text-red-400 text-xs text-center">{error}</p>}

            <button
              type="submit"
              disabled={submitting || code.length !== 6}
              className="w-full h-11 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition-all font-bold text-black flex items-center justify-center gap-2 disabled:opacity-50 text-sm mt-1"
            >
              {submitting ? '...' : (
                <>
                  Acessar painel
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        </div>

        <div className="text-center mt-5">
          <Link
            href="/"
            className="text-xs text-[#8b8f9a] hover:text-white transition-colors"
          >
            <span className="text-emerald-400">← Voltar pro trader</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
