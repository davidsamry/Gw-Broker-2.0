import { AdminGuard } from '@/components/admin/AdminGuard'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

// Wraps every /admin/* route with the gate + sidebar shell. Pages just render
// their content area on the right of the sidebar.

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="min-h-screen bg-[#0b0d12] text-white flex">
        <AdminSidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </AdminGuard>
  )
}
