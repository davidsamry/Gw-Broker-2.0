'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { api } from '@/lib/api'

// Wraps every page under /admin. Two checks:
//   1. Local: user.role === 'ADMIN' (fast, cached)
//   2. Server: GET /admin/ping returns 200 (authoritative, in case the cached
//      role drifted from the DB or the token was revoked)
//
// Non-admins are redirected to the admin login. While checking, renders a
// minimal loader. The /admin/login page itself bypasses the guard since the
// user isn't expected to be authenticated there yet.

// Paths that should NOT be guarded:
//   /admin/login    — pre-auth entry
//   /admin/setup-2fa— authed but pre-2FA (the guard sends ADMINs here itself)
const SKIP_GUARD_PATHS = ['/admin/login', '/admin/setup-2fa']

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router    = useRouter()
  const pathname  = usePathname() ?? ''
  const authStore = useAuthStore()
  const user      = authStore.user
  const loading   = authStore.loading
  const [verified, setVerified] = useState(false)

  const isPublic = SKIP_GUARD_PATHS.includes(pathname)

  // Kick off auth init when this guard mounts. The root TradingPage at "/"
  // also calls init, but a user landing directly on /admin (deep-link or
  // refresh) would otherwise sit forever on loading: true.
  useEffect(() => {
    if (loading) {
      void authStore.init()
    }
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Public admin paths (e.g. /admin/login) skip the check entirely.
    if (isPublic) {
      setVerified(true)
      return
    }

    // Wait for auth init to finish.
    if (loading) return

    // No user → send to LOGIN normal (com next=current). Apos logar como
    // admin, login redireciona pra /admin/login pra fazer o step-up 2FA.
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`)
      return
    }

    // Quick local check: role must be ADMIN. Fail fast.
    if (user.role !== 'ADMIN') {
      router.replace('/app')
      return
    }

    // Mandatory 2FA for ADMIN — funnel to setup if not enabled yet.
    if (!user.twoFactorEnabled) {
      router.replace('/admin/setup-2fa')
      return
    }

    // Authoritative server-side check. /admin/ping requer adminAuth=true
    // no JWT (set pelo /auth/admin-step-up). Se retornar 403 STEP_UP_REQUIRED,
    // mandamos pro /admin/login pra digitar o code 2FA.
    let cancelled = false
    api.get('/admin/ping')
      .then(() => { if (!cancelled) setVerified(true) })
      .catch((err) => {
        if (cancelled) return
        const code = err?.response?.data?.error
        if (code === 'STEP_UP_REQUIRED') {
          router.replace('/admin/login')
        } else {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`)
        }
      })

    return () => { cancelled = true }
  }, [loading, user, router, isPublic, pathname])

  if (!verified) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0f1117]">
        <p className="text-sm text-[#8b8f9a]">Verificando acesso…</p>
      </div>
    )
  }

  return <>{children}</>
}
