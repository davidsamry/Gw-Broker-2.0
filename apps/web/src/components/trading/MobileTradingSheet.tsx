'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, ArrowUp, ArrowDown } from 'lucide-react'
import { type Asset, type ChartTradeEvent } from '@/lib/mockData'
import { FlagPair } from '@/components/ui/FlagPair'
import { TradingPanel } from './TradingPanel'
import { cn } from '@/lib/utils'

interface MobileTradingSheetProps {
  asset: Asset
  marketPrice?: number
  shortLabels?: boolean
  accountId?: string
  onTradePlaced?: (trade: ChartTradeEvent | null) => void
}

export function MobileTradingSheet({ asset, marketPrice, shortLabels = true, accountId, onTradePlaced }: MobileTradingSheetProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn(
      'flex-shrink-0 bg-[#1d2130] border-t border-[#2a2e3b] transition-all duration-300 overflow-hidden flex flex-col',
      expanded ? 'h-[72vh]' : 'h-[84px]'
    )}>
      {/* Handle bar */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2e3b] flex-shrink-0 active:bg-white/5"
      >
        {/* Drag indicator */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[7px] w-8 h-[3px] bg-[#3a3f50] rounded-full pointer-events-none" />

        <div className="flex items-center gap-2">
          <FlagPair code1={asset.code1} code2={asset.code2} size={18} />
          <span className="text-sm font-bold text-white">{asset.symbol}</span>
          <span className="text-sm font-bold text-green-400">{asset.payout}%</span>
        </div>

        <div className="flex items-center gap-1 text-[#8b8f9a]">
          <span className="text-[10px] font-semibold">{expanded ? 'Fechar' : 'Negociar'}</span>
          {expanded
            ? <ChevronDown size={14} />
            : <ChevronUp size={14} />
          }
        </div>
      </button>

      {/* Collapsed: quick CALL/PUT buttons */}
      {!expanded && (
        <div className="flex gap-2 px-3 py-2.5 flex-shrink-0">
          <button className="flex-1 h-10 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] flex items-center justify-center gap-2 font-bold text-white text-sm transition-all">
            <span>Para cima</span>
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <ArrowUp size={13} strokeWidth={2.5} />
            </div>
          </button>
          <button className="flex-1 h-10 rounded-xl bg-red-500 hover:bg-red-400 active:scale-[0.98] flex items-center justify-center gap-2 font-bold text-white text-sm transition-all">
            <span>Para baixo</span>
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <ArrowDown size={13} strokeWidth={2.5} />
            </div>
          </button>
        </div>
      )}

      {/* Expanded: full TradingPanel */}
      {expanded && (
        <div className="flex-1 overflow-y-auto">
          <TradingPanel
            asset={asset}
            marketPrice={marketPrice}
            shortLabels={shortLabels}
            mobile
            accountId={accountId}
            onTradePlaced={onTradePlaced}
          />
        </div>
      )}
    </div>
  )
}
