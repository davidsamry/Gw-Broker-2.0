'use client'

import { BarChart2, Headphones, User, Trophy, TrendingUp, MoreHorizontal, Settings, Volume2, Grid2x2, ArrowLeftRight, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'

type SidebarTab = 'TRADE' | 'SUPORTE' | 'CONTA' | 'TORNEIOS' | 'MERCADO' | 'MAIS'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  onSettings?: () => void
}

interface NavItem {
  icon: React.ReactNode
  label: SidebarTab
  badge?: number
}

const navItems: NavItem[] = [
  { icon: <BarChart2 size={18} />, label: 'TRADE' },
  { icon: <Headphones size={18} />, label: 'SUPORTE' },
  { icon: <User size={18} />, label: 'CONTA' },
  { icon: <Trophy size={18} />, label: 'TORNEIOS', badge: 4 },
  { icon: <TrendingUp size={18} />, label: 'MERCADO', badge: 4 },
  { icon: <MoreHorizontal size={18} />, label: 'MAIS' },
]

export function Sidebar({ activeTab, onTabChange, onSettings }: SidebarProps) {
  return (
    <aside className="w-[62px] flex flex-col items-center bg-[#1d2130] border-r border-[#2a2e3b] flex-shrink-0 select-none z-10">
      {/* Hamburger */}
      <button className="w-full h-12 flex items-center justify-center text-[#8b8f9a] hover:text-white transition-colors border-b border-[#2a2e3b]">
        <Menu size={20} />
      </button>

      {/* Nav items */}
      <div className="flex flex-col items-center gap-0.5 pt-1 flex-1 w-full">
        {navItems.map((item) => {
          const isActive = activeTab === item.label
          return (
            <button
              key={item.label}
              title={item.label}
              onClick={() => onTabChange(item.label)}
              className={cn(
                'relative w-full flex flex-col items-center justify-center gap-0.5 py-2 px-1 transition-colors',
                isActive ? 'text-white' : 'text-[#8b8f9a] hover:text-white'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-blue-500 rounded-r-full" />
              )}
              <span className={cn(
                'w-8 h-8 flex items-center justify-center rounded-md relative',
                isActive ? 'bg-blue-600 text-white' : ''
              )}>
                {item.icon}
                {item.badge != null && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] flex items-center justify-center bg-blue-500 text-white text-[9px] font-bold rounded-full leading-none">
                    {item.badge}
                  </span>
                )}
              </span>
              <span className="text-[9px] font-semibold tracking-wide leading-none">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Bottom section */}
      <div className="flex flex-col items-center gap-1 pb-2 w-full border-t border-[#2a2e3b] pt-2">
        {/* 2x2 icon grid */}
        <div className="grid grid-cols-2 w-full px-1 gap-0.5">
          <button title="Expandir" className="flex items-center justify-center py-1.5 text-[#8b8f9a] hover:text-white transition-colors rounded">
            <Grid2x2 size={15} />
          </button>
          <button title="Transferir" className="flex items-center justify-center py-1.5 text-[#8b8f9a] hover:text-white transition-colors rounded">
            <ArrowLeftRight size={15} />
          </button>
          <button title="Configurações" onClick={onSettings} className="flex items-center justify-center py-1.5 text-[#8b8f9a] hover:text-white transition-colors rounded">
            <Settings size={15} />
          </button>
          <button title="Som" className="flex items-center justify-center py-1.5 text-[#8b8f9a] hover:text-white transition-colors rounded">
            <Volume2 size={15} />
          </button>
        </div>

        {/* Junte-se a nós */}
        <button
          title="Junte-se a nós"
          className="mx-2 w-[46px] flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 transition-colors"
        >
          <span className="text-[7px] font-bold text-white text-center leading-tight">JUNTE-SE A NÓS</span>
        </button>

        {/* Ajuda */}
        <button
          title="Ajuda"
          className="mx-2 w-[46px] flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 transition-colors"
        >
          <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
            <span className="text-white text-[8px]">●</span>
          </div>
          <span className="text-[8px] font-bold text-white leading-none">Ajuda</span>
        </button>
      </div>
    </aside>
  )
}
