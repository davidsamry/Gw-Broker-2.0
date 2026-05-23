'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { api } from '@/lib/api'

// Wraps every page under /admin. Two checks:
//   1. Local: user.role === 'ADMIN' (fast, cached)
//   2. Server: GET /admin/ping returns 200 (authoritative, in case the cached
//      role drifted from the DB or the token was revoked)
//
// Non-admins are redirected to /. While checking, renders a minimal loader.

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router    = useRouter()
  const authStore = useAuthStore()
  const user      = authStore.user
  const loading   = authStore.loading
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    // Wait for auth init to finish.
    if (loading) return

    // No user → redirect to login.
    if (!user) {
      router.replace('/login')
      return
    }

    // Quick local check: role must be ADMIN. Fail fast.
    if (user.role !== 'ADMIN') {
      router.replace('/')
      return
    }

    // Authoritative server-side check.
    let cancelled = false
    api.get('/admin/ping')
      .then(() => { if (!cancelled) setVerified(true) })
      .catch(() => { if (!cancelled) router.replace('/') })

    return () => { cancelled = true }
  }, [loading, user, router])

  if (!verified) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0f1117]">
        <p className="text-sm text-[#8b8f9a]">Verificando acesso…</p>
      </div>
    )
  }

  return <>{children}</>
}
