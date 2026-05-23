'use client'

import { usePathname } from 'next/navigation'
import { AdminGuard } from '@/components/admin/AdminGuard'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

// Wraps every /admin/* route with the gate + sidebar shell. On /admin/login
// (the only public admin path) we render the page full-screen without the
// sidebar — the page itself handles its own visual frame.

const FULLSCREEN_PATHS = ['/admin/login', '/admin/setup-2fa']

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname() ?? ''
  const fullscreen = FULLSCREEN_PATHS.includes(pathname)

  return (
    <AdminGuard>
      {fullscreen ? (
        children
      ) : (
        <div className="min-h-screen bg-[#0b0d12] text-white flex">
          <AdminSidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      )}
    </AdminGuard>
  )
}
