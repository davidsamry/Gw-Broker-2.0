'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Menu } from 'lucide-react'
import { AdminGuard } from '@/components/admin/AdminGuard'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

// Wraps every /admin/* route with the gate + sidebar shell. On /admin/login
// (the only public admin path) we render the page full-screen without the
// sidebar — the page itself handles its own visual frame.

const FULLSCREEN_PATHS = ['/admin/login', '/admin/setup-2fa']

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname() ?? ''
  const fullscreen = FULLSCREEN_PATHS.includes(pathname)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <AdminGuard>
      {fullscreen ? (
        children
      ) : (
        // Body has `h-full overflow-hidden` globally (locked for the
        // trading chart). Admin gets its own scroll context here:
        // `h-full overflow-y-auto` makes the wrapper take viewport
        // height and scroll internally when pages exceed the fold.
        // Sidebar's lg:sticky uses THIS div as its scroll context.
        <div className="h-full overflow-y-auto bg-[#0b0d12] text-white flex">
          <AdminSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
          {/* Content column — plain block so long pages flow + scroll. */}
          <div className="flex-1 min-w-0">
            {/* Mobile top bar — hamburger to open the drawer. lg:
                breakpoint matches the sidebar's docking threshold so
                the bar appears exactly when the drawer hides. */}
            <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 bg-[#0f1117] border-b border-[#1f232e]">
              <button
                onClick={() => setMobileOpen(true)}
                aria-label="Abrir menu"
                className="text-[#8b8f9a] hover:text-white"
              >
                <Menu size={22} />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <LayoutGrid size={14} />
                </div>
                <span className="text-sm font-bold text-white">Admin Panel</span>
              </div>
            </header>
            <main className="min-w-0">{children}</main>
          </div>
        </div>
      )}
    </AdminGuard>
  )
}
