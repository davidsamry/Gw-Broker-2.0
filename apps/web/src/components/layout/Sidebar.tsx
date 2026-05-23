'use client'

import { BarChart2, Headphones, User, Trophy, History, Users, Gift, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'

type SidebarTab = 'TRADE' | 'HISTORICO' | 'RANKING' | 'SUPORTE' | 'CONTA' | 'COPY' | 'BONUS'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  onSettings?: () => void
}

interface NavItem {
  icon:       React.ReactNode
  label:      SidebarTab
  text:       string
  badge?:     number
  highlight?: boolean
}

const navItems: NavItem[] = [
  { icon: <BarChart2 size={18} />,  label: 'TRADE',     text: 'TRADE' },
  { icon: <History size={18} />,    label: 'HISTORICO', text: 'HISTÓRICO' },
  { icon: <Trophy size={18} />,     label: 'RANKING',   text: 'RANKING' },
  { icon: <Gift size={18} />,       label: 'BONUS',     text: 'BÔNUS', highlight: true },
  { icon: <Headphones size={18} />, label: 'SUPORTE',   text: 'SUPORTE' },
  { icon: <User size={18} />,       label: 'CONTA',     text: 'CONTA' },
  { icon: <Users size={18} />,      label: 'COPY',      text: 'COPY' },
]

export function Sidebar({ activeTab, onTabChange, onSettings }: SidebarProps) {
  return (
    <aside className="w-[62px] flex flex-col items-center bg-[#1d2130] border-r border-[#2a2e3b] flex-shrink-0 select-none z-10">
      {/* Hamburger — matches the page header height so TRADE icon aligns with chart top */}
      <button className="w-full h-14 flex items-center justify-center text-[#8b8f9a] hover:text-white transition-colors border-b border-[#2a2e3b]">
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
                isActive
                  ? 'text-white'
                  : item.highlight
                    ? 'text-green-400 hover:text-green-300'
                    : 'text-[#8b8f9a] hover:text-white'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-blue-500 rounded-r-full" />
              )}
              <span className={cn(
                'w-8 h-8 flex items-center justify-center rounded-md relative',
                isActive
                  ? 'bg-blue-600 text-white'
                  : item.highlight
                    ? 'bg-green-400/10 ring-1 ring-green-400/40'
                    : ''
              )}>
                {item.icon}
                {item.badge != null && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] flex items-center justify-center bg-blue-500 text-white text-[9px] font-bold rounded-full leading-none">
                    {item.badge}
                  </span>
                )}
                {item.highlight && !isActive && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 animate-pulse ring-2 ring-[#1d2130]" />
                )}
              </span>
              <span className="text-[9px] font-semibold tracking-wide leading-none">
                {item.text}
              </span>
            </button>
          )
        })}
      </div>

    </aside>
  )
}
