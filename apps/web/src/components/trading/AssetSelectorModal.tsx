'use client'

import { useState, useMemo } from 'react'
import { X, Search, Star, ChevronUp, ChevronDown } from 'lucide-react'
import { ASSETS, DEFAULT_FAVORITES, type Asset } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { FlagPair } from '@/components/ui/FlagPair'

interface AssetSelectorModalProps {
  selectedAsset: Asset
  assets?: Asset[]
  onSelect: (asset: Asset) => void
  onClose: () => void
}

type Category = 'Moedas' | 'Cripto' | 'Matérias-Primas' | 'Ações'

// Canonical order shown to the user when a tab has at least one asset.
// We filter this down to "present" categories below so empty tabs don't
// render — important after the catalogue was trimmed to Binance crypto only.
const ALL_CATEGORIES: Category[] = ['Moedas', 'Cripto', 'Matérias-Primas', 'Ações']

export function AssetSelectorModal({ selectedAsset, assets = ASSETS, onSelect, onClose }: AssetSelectorModalProps) {
  // Only show category tabs that actually have at least one asset in the
  // current catalogue. Defaults activeCategory to the first present one
  // so the modal never opens on an empty tab.
  const categories = useMemo<Category[]>(() => {
    const present = new Set<Category>()
    for (const a of assets) present.add(a.category)
    return ALL_CATEGORIES.filter((c) => present.has(c))
  }, [assets])

  const [activeCategory, setActiveCategory] = useState<Category>(categories[0] ?? 'Cripto')
  const [search, setSearch] = useState('')
  const [showFavOnly, setShowFavOnly] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set(DEFAULT_FAVORITES))

  const filtered = useMemo(() => {
    // FOREX (cTrader) gets top billing — real-broker prices feel premium
    // next to OTC. Crypto (Binance) next; OTC last since it's synthesised.
    const sourceOrder: Record<'BINANCE' | 'INTERNAL' | 'FOREX', number> = { FOREX: 0, BINANCE: 1, INTERNAL: 2 }
    const typeOrder: Record<Asset['type'], number> = { Crypto: 0, OTC: 1, Forex: 2 }

    return assets
      .filter((a) => {
        if (a.category !== activeCategory) return false
        if (showFavOnly && !favorites.has(a.id)) return false
        if (search) {
          const query = search.toLowerCase()
          const haystack = `${a.symbol} ${a.label} ${a.marketSymbol ?? ''}`.toLowerCase()
          if (!haystack.includes(query)) return false
        }
        return true
      })
      .sort((a, b) => {
        const sourceDelta = sourceOrder[a.source ?? 'INTERNAL'] - sourceOrder[b.source ?? 'INTERNAL']
        if (sourceDelta !== 0) return sourceDelta
        const typeDelta = typeOrder[a.type] - typeOrder[b.type]
        if (typeDelta !== 0) return typeDelta
        return b.payout - a.payout
      })
  }, [assets, activeCategory, search, showFavOnly, favorites])

  function toggleFavorite(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setFavorites((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex md:items-stretch md:justify-start items-end bg-black/50 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex flex-col bg-[#151822] border-blue-500/15 shadow-2xl shadow-blue-500/10',
          'animate-scaleIn',
          // desktop: tall left panel; mobile: bottom sheet
          'md:w-[460px] md:h-full md:border-r md:rounded-none',
          'w-full max-h-[88vh] rounded-t-2xl border-t border-[#2a2e3b]'
        )}
      >
      {/* Selected-asset chip removed entirely — the modal already shows
          the "Selecione o par de negociação" header with its own X close
          right below this row, and the current asset is visible in the
          main top bar. Was a redundant control. */}

      {/* Panel header — proper breathing room now that the chip above
          was removed. pt-5 gives 20px from the modal's top edge, pb-4
          separates from the tabs below. Heading bumped to text-[15px]
          so it doesn't feel undersized at this padding. Close button
          gets a rounded hit area matching other modals in the app. */}
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <h2 className="text-[15px] font-bold text-white">Selecione o par de negociação</h2>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1 px-4 pb-3">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-colors',
              activeCategory === cat
                ? 'bg-blue-600 text-white'
                : 'text-[#8b8f9a] hover:text-white hover:bg-white/5'
            )}
          >
            {cat.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Search + favorites */}
      <div className="flex items-center gap-2 px-4 pb-3">
        {/* Favorites toggle */}
        <button
          onClick={() => setShowFavOnly((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-bold flex-shrink-0 transition-colors',
            showFavOnly
              ? 'border-yellow-500/60 bg-yellow-500/10 text-yellow-400'
              : 'border-[#2a2e3b] text-[#8b8f9a] hover:border-yellow-500/40 hover:text-yellow-400'
          )}
        >
          <Star size={13} className={showFavOnly ? 'fill-yellow-400 text-yellow-400' : ''} />
          <span>{favorites.size}</span>
        </button>

        {/* Search */}
        <div className="flex-1 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Procurar"
            className="w-full h-9 bg-[#1d2130] border border-[#2a2e3b] rounded-lg pl-8 pr-3 text-sm text-white placeholder-[#8b8f9a] outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[220px_90px_60px] gap-x-4 px-4 pb-1">
        <div className="text-[11px] text-[#8b8f9a]">Nome</div>
        <div className="text-[11px] text-[#8b8f9a]">Mudança 24h</div>
        <div className="flex items-center gap-0.5 text-[11px] text-[#8b8f9a]">
          Lucro
          <ChevronDown size={10} />
        </div>
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-[#8b8f9a]">
            Nenhum ativo encontrado
          </div>
        ) : (
          filtered.map((asset, index) => {
            const isActive = asset.id === selectedAsset.id
            const isFav = favorites.has(asset.id)
            const isUp = asset.change24h >= 0
            const prevAsset = filtered[index - 1]
            const showGroupDivider = index > 0 && asset.source !== prevAsset?.source
            const groupLabel = asset.source === 'BINANCE' ? 'BINANCE' : asset.type === 'Crypto' ? 'CRIPTO' : asset.type

            return (
              <div key={asset.id}>
                {showGroupDivider && (
                  <div className="px-4 py-2 bg-[#1a1e2e] border-y border-[#2a2e3b]">
                    <span className="text-[10px] font-bold text-[#8b8f9a] tracking-widest uppercase">
                      {groupLabel}
                    </span>
                  </div>
                )}
                <div
                  onClick={() => { onSelect(asset); onClose() }}
                  className={cn(
                    'grid grid-cols-[220px_90px_60px] gap-x-4 items-center px-4 py-2.5 cursor-pointer transition-colors border-b border-[#1e2235]',
                    isActive ? 'bg-[#252a3a]' : 'hover:bg-white/5'
                  )}
                >
                {/* Name */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    onClick={(e) => toggleFavorite(asset.id, e)}
                    className="flex-shrink-0 transition-colors"
                  >
                    <Star
                      size={14}
                      className={isFav ? 'fill-yellow-400 text-yellow-400' : 'text-[#3a3f50] hover:text-yellow-400'}
                    />
                  </button>
                  <FlagPair code1={asset.code1} code2={asset.code2} size={22} />
                  <span className="text-sm font-semibold text-white truncate">{asset.symbol}</span>
                  {asset.type === 'OTC' && (
                    <span className="text-[9px] text-[#8b8f9a] border border-[#3a3f50] px-1 py-0.5 rounded flex-shrink-0">OTC</span>
                  )}
                </div>

                {/* 24h change */}
                <div className={cn('flex items-center gap-1 text-xs font-semibold', isUp ? 'text-green-400' : 'text-red-400')}>
                  {isUp ? <ChevronUp size={12} className="flex-shrink-0" /> : <ChevronDown size={12} className="flex-shrink-0" />}
                  {isUp ? '+' : ''}{asset.change24h.toFixed(2)}%
                </div>

                {/* Payout */}
                <div className="text-sm font-bold text-green-400">{asset.payout}%</div>
                </div>
              </div>
            )
          })
        )}
      </div>
      </div>
    </div>
  )
}
