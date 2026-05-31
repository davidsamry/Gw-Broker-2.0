'use client'

// Banner vermelho fixo no TOPO da tela exibido APENAS quando admin esta
// impersonando um usuario (flag sessionStorage.impersonating presente).
//
// Por que sessionStorage e nao zustand: o flag tem que estar disponivel
// IMEDIATAMENTE no primeiro paint da aba, antes do auth store inicializar.
// Senao tem flash de UI normal antes do banner aparecer (~500ms).
//
// O botao "Sair da Impersonação" chama logout() do auth store que detecta
// modo impersonation e so' remove sessionStorage (preserva admin na aba
// original) + redireciona pra /login.
//
// Self-skips na pagina /admin/impersonate (intermediaria) pra evitar
// double-paint do banner durante o setup do token.

import { useEffect, useState } from 'react'
import { AlertTriangle, LogOut } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/auth'

export function ImpersonationBanner() {
  const [email, setEmail] = useState<string | null>(null)
  const pathname = usePathname()
  const logout   = useAuthStore(s => s.logout)

  useEffect(() => {
    // Lê só no mount + escuta storage events. Mudar de aba muda o sessionStorage
    // tambem (sessionStorage tem escopo de aba — uma aba nao ve mudancas da outra),
    // mas window.dispatchEvent('storage') do nosso codigo (login/logout/impersonate)
    // dispara o listener da MESMA aba quando precisamos atualizar.
    const read = () => {
      try {
        setEmail(sessionStorage.getItem('impersonating'))
      } catch {
        setEmail(null)
      }
    }
    read()
    window.addEventListener('storage', read)
    return () => window.removeEventListener('storage', read)
  }, [])

  // Skips:
  //   - SSR (sem window/sessionStorage)
  //   - /admin/impersonate (rota intermediaria — banner aparece depois do redirect)
  //   - /login (no caso de logout abrir aqui)
  //   - quando nao tem flag (uso normal admin/user)
  if (!email)                              return null
  if (pathname?.startsWith('/admin/impersonate')) return null
  if (pathname?.startsWith('/login'))      return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] bg-red-600 text-white shadow-lg">
      <div className="px-4 py-2 flex items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle size={16} className="shrink-0 animate-pulse" />
          <span className="font-bold truncate">
            ⚠️ MODO IMPERSONAÇÃO — logado como <strong className="underline">{email}</strong>
          </span>
        </div>
        <button
          onClick={() => logout()}
          className="flex items-center gap-1.5 shrink-0 px-3 py-1 rounded bg-white/20 hover:bg-white/30 font-semibold transition-colors"
          title="Encerrar impersonação e voltar pra tela de login"
        >
          <LogOut size={13} />
          Sair
        </button>
      </div>
    </div>
  )
}
