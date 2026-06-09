'use client'

// Rota intermediaria. Admin clica em "Logar como Usuario" no drawer
// → POST /admin/users/:id/impersonate → token JWT
// → window.open('/admin/impersonate#t=TOKEN&u=email', '_blank')
//
// O TOKEN vai no HASH (fragmento '#') e nao no query — fragmentos NAO
// sao enviados pro servidor, ficam so' no client. Evita o token vazar
// em access logs do Cloudflare/EasyPanel/proxy.
//
// Esta pagina:
//   1. Le o token do window.location.hash
//   2. Salva em sessionStorage (por aba — preserva sessao do admin
//      na aba original que usa localStorage)
//   3. Salva flag 'impersonating' com email do user pro banner global
//   4. Limpa o hash imediatamente da URL (anti-shoulder-surfing)
//   5. Redireciona pra '/' (home do user)
//
// Suspense wrapper exigido pelo Next 16 quando usa useSearchParams,
// mas como estamos usando hash (nao query), nao precisamos do
// useSearchParams aqui — Suspense ok mas opcional.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertTriangle } from 'lucide-react'

export default function ImpersonatePage() {
  const router = useRouter()
  const [status, setStatus] = useState<'parsing' | 'redirecting' | 'error'>('parsing')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    try {
      // Hash format: #t=TOKEN&u=email@x.com
      const hash = window.location.hash.replace(/^#/, '')
      const params = new URLSearchParams(hash)
      const token  = params.get('t')
      const userEmail = params.get('u') ?? '(usuário)'

      if (!token) {
        setStatus('error')
        setErrorMsg('Token não encontrado no fragmento da URL.')
        return
      }

      // Salva por aba — preserva sessao admin no localStorage da aba original
      sessionStorage.setItem('impersonation_token', token)
      sessionStorage.setItem('impersonating', userEmail)

      // Limpa o hash da URL imediatamente (history.replaceState nao recarrega)
      window.history.replaceState(null, '', window.location.pathname)

      setStatus('redirecting')
      // Pequeno delay pra garantir que o sessionStorage commitou + render
      // do feedback de "Redirecionando" alcanca o usuario
      setTimeout(() => {
        // window.location.replace pra forcar reload completo — garante que
        // o auth store inicializa do zero lendo o sessionStorage novo.
        window.location.replace('/app')
      }, 300)
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(String(err?.message ?? err))
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0d12] text-white p-6">
      <div className="w-full max-w-md rounded-xl border border-[#1f232e] bg-[#13161f] p-6">
        {status === 'parsing' && (
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-emerald-400" size={20} />
            <div>
              <div className="font-semibold">Preparando impersonação…</div>
              <div className="text-xs text-[#8b8f9a] mt-0.5">Lendo token de sessão.</div>
            </div>
          </div>
        )}
        {status === 'redirecting' && (
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-emerald-400" size={20} />
            <div>
              <div className="font-semibold">Redirecionando…</div>
              <div className="text-xs text-[#8b8f9a] mt-0.5">Você está prestes a entrar na conta do usuário.</div>
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div>
              <div className="font-semibold text-red-400">Falha na impersonação</div>
              <div className="text-xs text-[#8b8f9a] mt-1">{errorMsg}</div>
              <button
                onClick={() => router.replace('/admin/operacoes')}
                className="mt-3 text-xs text-emerald-400 hover:underline"
              >
                ← Voltar pro admin
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
