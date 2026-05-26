'use client'

import { useState } from 'react'
import { Bell, ChevronDown, Plus, X, GraduationCap, Gem } from 'lucide-react'
import { type Asset } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { AccountDropdown } from './AccountDropdown'
import { Logo } from './Logo'
import { FlagPair } from '@/components/ui/FlagPair'

interface HeaderProps {
  selectedAsset: Asset
  onSelectAsset: (asset: Asset) => void
  openAssets: Asset[]
  onOpenAsset: (asset: Asset) => void
  onCloseAsset: (asset: Asset) => void
  onOpenSelector: () => void
  onDeposito?: () => void
  onRetirada?: () => void
  onTransacoes?: () => void
  onOperacoes?: () => void
  onMinhaConta?: () => void
  onLogout?: () => void
  onResetDemo?: () => Promise<void>
  isDemo: boolean
  onSelectDemo: () => void
  onSelectReal: () => void
  demoBalance: number
  realBalance: number
  balance: number
  userEmail?: string
  userId?: string
}

export function Header({
  selectedAsset,
  onSelectAsset,
  openAssets,
  onOpenAsset,
  onCloseAsset,
  onOpenSelector,
  onDeposito,
  onRetirada,
  onTransacoes,
  onOperacoes,
  onMinhaConta,
  onLogout,
  onResetDemo,
  isDemo,
  onSelectDemo,
  onSelectReal,
  demoBalance,
  realBalance,
  balance,
  userEmail = '',
  userId = '',
}: HeaderProps) {
  const [accountOpen, setAccountOpen] = useState(false)

  return (
    <div className="flex-shrink-0">
      {/* Single bar — Logo + asset tabs + controls */}
      <div className="h-14 flex items-stretch bg-[#1d2130] border-b border-[#2a2e3b] gap-3">
        {/* Logo */}
        <div className="flex items-center pl-4 pr-2 flex-shrink-0">
          <Logo size="md" subtitle />
        </div>

        {/* Asset tabs — inline, scrollable when overflowing */}
        <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
          {/* Add asset button */}
          <button
            onClick={onOpenSelector}
            className="w-10 flex items-center justify-center text-white bg-blue-600 hover:bg-blue-500 transition-colors flex-shrink-0 rounded-lg my-2"
            title="Adicionar ativo"
          >
            <Plus size={16} />
          </button>

          {openAssets.map((asset) => {
            const isActive = selectedAsset.id === asset.id
            return (
              <div
                key={asset.id}
                onClick={() => onSelectAsset(asset)}
                className={cn(
                  'flex items-center gap-2 px-3 min-w-max cursor-pointer border-r border-[#2a2e3b] transition-colors relative',
                  isActive
                    ? 'bg-[#252a3a] text-white'
                    : 'text-[#8b8f9a] hover:bg-white/5 hover:text-white'
                )}
              >
                {/* Active bottom border */}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500" />
                )}
                <FlagPair code1={asset.code1} code2={asset.code2} size={18} />
                <div>
                  <div className="text-xs font-semibold leading-tight">{asset.symbol}</div>
                  <div className="text-[10px] text-green-400 font-bold leading-tight">{asset.payout}%</div>
                </div>
                {isActive && (
                  <div className="flex items-center gap-1 ml-1">
                    <ChevronDown size={12} className="text-[#8b8f9a]" />
                    <button
                      onClick={(e) => { e.stopPropagation(); onCloseAsset(asset) }}
                      className="text-[#8b8f9a] hover:text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 pr-4 flex-shrink-0">
          {/* Bell */}
          <button className="relative w-8 h-8 flex items-center justify-center rounded-lg text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors">
            <Bell size={16} />
          </button>

          {/* Account toggle */}
          <div className="relative">
            <button
              onClick={() => setAccountOpen((v) => !v)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors',
                accountOpen
                  ? 'bg-[#252a3a] border-blue-500/60'
                  : 'bg-[#252a3a] border-[#2a2e3b] hover:border-blue-500/40'
              )}
              // isDemo comes from the auth store which rehydrates from
              // localStorage on the client only. SSR renders the default
              // (DEMO) icon; client may render the persisted (REAL) icon.
              // Suppress the (intentional) mismatch on first render.
              suppressHydrationWarning
            >
              {isDemo
                ? <GraduationCap size={18} className="text-yellow-400 flex-shrink-0" />
                : <Gem size={18} className="text-purple-400 flex-shrink-0" />
              }
              <div className="text-left">
                <div className={cn('text-[10px] font-bold leading-tight', isDemo ? 'text-yellow-400' : 'text-green-400')}>
                  {isDemo ? 'CONTA DEMO' : 'CONTA REAL'}
                </div>
                <div className="text-sm font-bold text-white leading-tight">
                  R${balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <ChevronDown size={12} className={cn('text-[#8b8f9a] transition-transform', accountOpen && 'rotate-180')} />
            </button>

            {accountOpen && (
              <AccountDropdown
                isDemo={isDemo}
                onSelectDemo={() => { onSelectDemo(); setAccountOpen(false) }}
                onSelectReal={() => { onSelectReal(); setAccountOpen(false) }}
                demoBalance={demoBalance}
                realBalance={realBalance}
                userEmail={userEmail}
                userId={userId}
                onClose={() => setAccountOpen(false)}
                onLogout={onLogout ?? (() => {})}
                onResetDemo={onResetDemo ?? (() => Promise.resolve())}
                onDeposito={onDeposito ?? (() => {})}
                onRetirada={onRetirada ?? (() => {})}
                onTransacoes={onTransacoes ?? (() => {})}
                onOperacoes={onOperacoes ?? (() => {})}
                onMinhaConta={onMinhaConta ?? (() => {})}
              />
            )}
          </div>

          {/* Deposit */}
          <button onClick={onDeposito} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 hover:bg-green-400 transition-colors text-sm font-bold text-white">
            <Plus size={14} />
            Depósito
          </button>

          {/* Withdraw */}
          <button onClick={onRetirada} className="px-4 py-2 rounded-lg border border-[#3a3f50] hover:border-white/30 transition-colors text-sm font-medium text-white hover:bg-white/5">
            Retirada
          </button>
        </div>
      </div>
    </div>
  )
}
