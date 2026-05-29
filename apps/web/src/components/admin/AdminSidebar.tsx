'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutGrid, Users, Wallet, Activity, ShieldCheck,
  ArrowDownToLine, ArrowUpFromLine, MessageSquare, Network,
  Copy, Layers, Gift, Zap, TrendingUp, Clock, FileSpreadsheet,
  Trophy, Image as ImageIcon, FileText, Mail, CreditCard, Radio,
  Settings, X, Plug, Webhook,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MenuItem {
  href:  string
  label: string
  icon:  React.ReactNode
}

// Order mirrors the reference admin design.
const MENU: MenuItem[] = [
  { href: '/admin',                label: 'Dashboard',       icon: <LayoutGrid size={15} /> },
  { href: '/admin/usuarios',       label: 'Usuários',        icon: <Users size={15} /> },
  { href: '/admin/carteira',       label: 'Carteira',        icon: <Wallet size={15} /> },
  { href: '/admin/operacoes',      label: 'Operações',       icon: <Activity size={15} /> },
  { href: '/admin/verificacao',    label: 'Verificação',     icon: <ShieldCheck size={15} /> },
  { href: '/admin/depositos',      label: 'Depósitos',       icon: <ArrowDownToLine size={15} /> },
  { href: '/admin/saques',         label: 'Saques',          icon: <ArrowUpFromLine size={15} /> },
  { href: '/admin/tickets',        label: 'Tickets',         icon: <MessageSquare size={15} /> },
  { href: '/admin/afiliados',      label: 'Afiliados',       icon: <Network size={15} /> },
  { href: '/admin/copy-trading',   label: 'Copy Trading',    icon: <Copy size={15} /> },
  { href: '/admin/niveis',         label: 'Níveis',          icon: <Layers size={15} /> },
  { href: '/admin/bonus',          label: 'Bônus',           icon: <Gift size={15} /> },
  { href: '/admin/boosters',       label: 'Boosters',        icon: <Zap size={15} /> },
  { href: '/admin/ativos',         label: 'Ativos',          icon: <TrendingUp size={15} /> },
  { href: '/admin/otc',            label: 'Motor OTC',       icon: <Radio size={15} /> },
  { href: '/admin/horario-mercado',label: 'Horário Mercado', icon: <Clock size={15} /> },
  { href: '/admin/cadastro-otc',   label: 'Cadastro OTC',    icon: <FileSpreadsheet size={15} /> },
  { href: '/admin/ranking',        label: 'Ranking',         icon: <Trophy size={15} /> },
  { href: '/admin/banner-promo',   label: 'Banner Promo',    icon: <ImageIcon size={15} /> },
  { href: '/admin/documentos',     label: 'Documentos',      icon: <FileText size={15} /> },
  { href: '/admin/emails',         label: 'Emails',          icon: <Mail size={15} /> },
  { href: '/admin/pagamentos',     label: 'Pagamentos',      icon: <CreditCard size={15} /> },
  { href: '/admin/configuracoes',  label: 'Configurações',   icon: <Settings size={15} /> },
  { href: '/admin/api',            label: 'API',             icon: <Plug size={15} /> },
  { href: '/admin/webhooks',       label: 'Webhooks',        icon: <Webhook size={15} /> },
  { href: '/admin/meta-pixel',     label: 'Meta Pixel',      icon: <Activity size={15} /> },
]

interface AdminSidebarProps {
  /** Controls the off-canvas drawer on mobile. Ignored at lg+ where the sidebar is always docked. */
  mobileOpen?: boolean
  onClose?:    () => void
}

// Off-canvas drawer < lg, docked column at lg+. Backdrop renders below the
// drawer on mobile so a tap outside closes it. Tapping a menu link auto-
// closes the drawer too via onClose.
export function AdminSidebar({ mobileOpen = false, onClose }: AdminSidebarProps) {
  const pathname = usePathname() ?? ''

  return (
    <>
      {/* Backdrop — only on mobile while the drawer is open */}
      {mobileOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'w-[220px] flex-shrink-0 bg-[#0f1117] border-r border-[#1f232e] flex flex-col h-screen z-50',
          // Mobile: fixed off-canvas drawer that slides in from the left.
          'fixed top-0 left-0 transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: docked in the flex flow, always visible.
          'lg:sticky lg:top-0 lg:translate-x-0',
        )}
      >
        {/* Brand header */}
        <div className="px-4 py-4 border-b border-[#1f232e] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <LayoutGrid size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white leading-tight">Admin Panel</div>
            <div className="text-[10px] text-[#8b8f9a] leading-tight">Gerenciamento</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="ml-auto text-[#8b8f9a] hover:text-white lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav list */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {MENU.map((item) => {
            const active = item.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors my-0.5',
                  active
                    ? 'bg-emerald-500/15 text-white font-semibold border border-emerald-500/30'
                    : 'text-[#8b8f9a] hover:text-white hover:bg-white/5'
                )}
              >
                <span className={active ? 'text-emerald-400' : ''}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
