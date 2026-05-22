'use client'

import { BarChart2, Headphones, User, Trophy, TrendingUp, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

type SidebarTab = 'TRADE' | 'SUPORTE' | 'CONTA' | 'TORNEIOS' | 'MERCADO' | 'MAIS'

interface MobileNavProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
}

const items: { icon: React.FC<{ size: number }>; label: string; tab: SidebarTab; badge?: number }[] = [
  { icon: BarChart2,      label: 'Trade',     tab: 'TRADE'    },
  { icon: Headphones,     label: 'Suporte',   tab: 'SUPORTE'  },
  { icon: User,           label: 'Conta',     tab: 'CONTA'    },
  { icon: Trophy,         label: 'Torneios',  tab: 'TORNEIOS', badge: 4 },
  { icon: TrendingUp,     label: 'Mercado',   tab: 'MERCADO'  },
  { icon: MoreHorizontal, label: 'Mais',      tab: 'MAIS'     },
]

export function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  return (
    <nav className="flex items-stretch bg-[#1d2130] border-t border-[#2a2e3b] flex-shrink-0">
      {items.map(({ icon: Icon, label, tab, badge }) => {
        const isActive = activeTab === tab
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative transition-colors',
              isActive ? 'text-blue-400' : 'text-[#8b8f9a]'
            )}
          >
            {isActive && (
              <span className="absolute top-0 left-2 right-2 h-[2px] bg-blue-500 rounded-b" />
            )}
            <div className="relative">
              <Icon size={18} />
              {badge != null && (
                <span className="absolute -top-1 -right-2 min-w-[13px] h-[13px] px-[2px] flex items-center justify-center bg-blue-500 text-white text-[8px] font-bold rounded-full leading-none">
                  {badge}
                </span>
              )}
            </div>
            <span className="text-[9px] font-semibold leading-none">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
