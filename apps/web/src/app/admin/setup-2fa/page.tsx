'use client'

import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { TwoFactorSetup } from '@/components/admin/TwoFactorSetup'
import { useAuthStore } from '@/store/auth'
import { api } from '@/lib/api'

// Mandatory 2FA setup page. AdminGuard sends ADMIN users without 2FA here.
// Once they enable, we refresh /auth/me so user.twoFactorEnabled flips to
// true in the store, and route them to /admin.
export default function AdminSetup2FAPage() {
  const router = useRouter()

  async function handleEnabled() {
    // Refresh the user object so AdminGuard sees twoFactorEnabled = true.
    try {
      const { data } = await api.get('/auth/me')
      if (data?.user) useAuthStore.setState({ user: data.user })
    } catch { /* the redirect below will retry the guard */ }
    router.replace('/admin')
  }

  return (
    <div className="min-h-screen bg-[#0b0d12] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[440px]">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mb-3">
            <ShieldCheck size={22} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Ativar 2FA obrigatório</h1>
          <p className="text-xs text-[#8b8f9a] mt-1 text-center max-w-xs">
            Todo administrador precisa de verificação em duas etapas. Configure
            agora para continuar.
          </p>
        </div>

        <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-6 shadow-2xl shadow-black/40">
          <TwoFactorSetup onEnabled={handleEnabled} cancellable={false} />
        </div>
      </div>
    </div>
  )
}
