'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore, useCurrentAccount } from '@/store/auth'
import { useOperationsStore } from '@/store/operations'
import { GraduationCap, Plus, Bell, ChevronDown, X } from 'lucide-react'
import { getAccountLevel } from '@/lib/accountLevel'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { Logo } from '@/components/layout/Logo'
import { MobileNav } from '@/components/layout/MobileNav'
import { TradingChart } from '@/components/trading/TradingChart'
import { TradingPanel } from '@/components/trading/TradingPanel'
import { TradingCompactCard } from '@/components/trading/TradingCompactCard'
import { AccountSwitchModal } from '@/components/layout/AccountSwitchModal'
import { AssetInfoModal } from '@/components/trading/AssetInfoModal'
import { AssetSelectorModal } from '@/components/trading/AssetSelectorModal'
import { NiveisModal } from '@/components/layout/NiveisModal'
import { SupportPanel } from '@/components/layout/SupportPanel'
import { ContaPage } from '@/components/conta/ContaPage'
import { HistoricoPanel } from '@/components/layout/HistoricoPanel'
import { RankingPanel } from '@/components/layout/RankingPanel'
import { BonusPanel } from '@/components/layout/BonusPanel'
import { ConfiguracoesPanel, type TradeSettings } from '@/components/layout/ConfiguracoesPanel'
import { DepositoModal } from '@/components/deposito/DepositoModal'
import { BonusWelcomeModal } from '@/components/layout/BonusWelcomeModal'
import { AccountDropdown } from '@/components/layout/AccountDropdown'
import { ASSETS, type Asset, type ActiveTrade, type ChartTradeEvent } from '@/lib/mockData'
import { useBinanceTicker } from '@/lib/binanceMarket'
import { fetchMarketAssets, fetchDisabledAssetIds } from '@/lib/marketApi'
import { useOperationsStream } from '@/lib/operationsStream'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type SidebarTab = 'TRADE' | 'HISTORICO' | 'RANKING' | 'SUPORTE' | 'CONTA' | 'COPY' | 'BONUS'

// ── localStorage-backed asset tabs (persist across sessions) ──────────────
// IDs only — full Asset objects are resolved against ASSETS on read so a
// catalog change (asset removed / renamed) doesn't crash; missing IDs are
// silently dropped.
//
// IMPORTANT: localStorage is read inside a useEffect, NOT inside the
// useState initializer. Reading from useState would diverge between SSR
// (typeof window === 'undefined' → defaults) and the client's first
// render (reads persisted values), causing a hydration mismatch on the
// asset tabs (FlagPair tree differs).
const OPEN_ASSETS_KEY     = 'vx:openAssetIds'
const SELECTED_ASSET_KEY  = 'vx:selectedAssetId'
const DEFAULT_OPEN_ASSETS = [ASSETS[0], ASSETS[3]]
const DEFAULT_SELECTED    = ASSETS[3]

export default function TradingPage() {
  const router        = useRouter()
  const authStore     = useAuthStore()
  const currentAccount = useCurrentAccount(authStore)

  // Live operations sync — opens an SSE to /operations/stream so trades
  // placed via the Bot API (or on a second logged-in device) appear in
  // this tab instantly + resolution credits show up without reload.
  useOperationsStream()

  useEffect(() => {
    authStore.init().then(() => {
      if (!useAuthStore.getState().user) router.replace('/login')
    })
  }, [])

  // Pre-warm the API connection: opens TLS + TCP + CORS preflight on page load
  // so the first trade doesn't pay the ~340ms handshake cost. Cheap fire-and-
  // forget GET — server returns 200 in <5ms.
  useEffect(() => {
    api.get('/health').catch(() => { /* silent: warming, not blocking */ })
  }, [])

  useEffect(() => {
    let active = true

    async function loadMarketAssets() {
      try {
        // Parallel: Binance assets come pre-filtered by admin status
        // (handled server-side in listBinanceAssets). OTC entries live
        // in mockData.ts on the frontend, so we also fetch the list of
        // admin-disabled IDs to hide them client-side.
        const [binanceAssets, disabledIds] = await Promise.all([
          fetchMarketAssets('BINANCE'),
          fetchDisabledAssetIds().catch(() => [] as string[]),
        ])
        if (!active || binanceAssets.length === 0) return

        const disabled = new Set(disabledIds)
        const internalAssets = ASSETS.filter(
          (asset) => asset.source !== 'BINANCE' && !disabled.has(asset.id),
        )
        const nextAssets = [...internalAssets, ...binanceAssets]

        setAssets(nextAssets)
        setSelectedAsset((prev) => nextAssets.find((asset) => asset.id === prev.id) ?? prev)
        setOpenAssets((prev) => prev.map((asset) => nextAssets.find((next) => next.id === asset.id) ?? asset))
      } catch {
        if (active) setAssets(ASSETS)
      }
    }

    loadMarketAssets()
    return () => { active = false }
  }, [])

  const [assets, setAssets] = useState<Asset[]>(ASSETS)
  // openAssets + selectedAsset persist across sessions in localStorage so
  // the user comes back to the same tabs they last had open. Stored as
  // bare IDs and re-resolved against ASSETS after mount (NOT in the
  // useState initializer — that would cause a hydration mismatch since
  // SSR can't read localStorage and the asset tab tree would diverge).
  const [selectedAsset, setSelectedAsset] = useState<Asset>(DEFAULT_SELECTED)
  const [openAssets,    setOpenAssets]    = useState<Asset[]>(DEFAULT_OPEN_ASSETS)

  // After hydration, restore the user's last-seen tabs. Defaults render
  // for ~16ms before this fires, but the swap is invisible because the
  // chart and trading panel hide until auth.init resolves anyway.
  // `restoredRef` flips to true after the restore completes — the persist
  // effects below check it to avoid overwriting the persisted state with
  // the defaults on initial mount (effects fire even when state hasn't
  // changed yet, so without the guard the defaults would clobber the
  // user's saved tabs on every page load).
  const restoredRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') { restoredRef.current = true; return }
    try {
      const raw = localStorage.getItem(OPEN_ASSETS_KEY)
      if (raw) {
        const ids = JSON.parse(raw) as unknown
        if (Array.isArray(ids)) {
          const resolved = ids
            .map((id) => ASSETS.find((a) => a.id === id))
            .filter((a): a is Asset => !!a)
          if (resolved.length > 0) setOpenAssets(resolved)
        }
      }
      const selId = localStorage.getItem(SELECTED_ASSET_KEY)
      if (selId) {
        const sel = ASSETS.find((a) => a.id === selId)
        if (sel) setSelectedAsset(sel)
      }
    } catch { /* quota / parse / disabled */ }
    restoredRef.current = true
  }, [])

  // Persist on every change. Guarded by restoredRef so the initial mount
  // (still rendering defaults) doesn't write defaults to localStorage
  // before the restore effect above has had a chance to read the
  // previously persisted values.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!restoredRef.current) return
    try { localStorage.setItem(OPEN_ASSETS_KEY, JSON.stringify(openAssets.map(a => a.id))) }
    catch { /* quota / disabled */ }
  }, [openAssets])
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!restoredRef.current) return
    try { localStorage.setItem(SELECTED_ASSET_KEY, selectedAsset.id) }
    catch { /* quota / disabled */ }
  }, [selectedAsset])
  const [switchModal, setSwitchModal] = useState<'demo' | 'real' | null>(null)
  const [assetInfoOpen, setAssetInfoOpen] = useState(false)
  const [assetSelectorOpen, setAssetSelectorOpen] = useState(false)
  const [depositoOpen, setDepositoOpen] = useState(false)
  // Optional bonus code to pre-apply when the deposit modal opens. Set by
  // the BonusPanel's "Depositar agora" CTA so the user doesn't have to
  // copy/paste the code manually.
  const [depositoBonusCode, setDepositoBonusCode] = useState<string | undefined>(undefined)
  const [contaInitialTab, setContaInitialTab] = useState<'retirada' | 'minha-conta'>('minha-conta')
  const [configOpen, setConfigOpen] = useState(false)
  const [niveisOpen, setNiveisOpen] = useState(false)
  const [theme, setTheme] = useState<'diurno' | 'crepusculo' | 'noite'>('noite')
  const [tradeSettings, setTradeSettings] = useState<TradeSettings>({
    autoScroll: true,
    performanceMode: true,
    shortLabels: true,
  })
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('TRADE')
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false)
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([])
  const [chartTradeEvents, setChartTradeEvents] = useState<ChartTradeEvent[]>([])

  // ── Chart-marker sync for remote/bot trades ───────────────────────────
  // Locally-placed trades go through handleTradePlaced → activeTrades.
  // Trades opened via the Bot API or on another logged-in device arrive
  // via /operations/stream → useOperationsStream upserts into the store,
  // but the chart's activeTrades wouldn't see them without this effect.
  //
  // Adds OPEN ops (for the currently-selected asset only) that aren't
  // already in activeTrades, and prunes activeTrades entries whose store
  // status flipped away from OPEN (resolved or cancelled). Entries the
  // store hasn't seen yet (fresh local trades pending SSE delivery) stay
  // — they'll be reconciled on the next pass.
  const storeOps = useOperationsStore((s) => s.operations)
  // BRT-shifted epoch seconds (UTC - 3h) — matches what placeTrade uses
  // for entryTime/expiryTime so the chart renders both with one formula.
  const BRT_OFFSET = -3 * 3600
  useEffect(() => {
    setActiveTrades((prev) => {
      const prevIds        = new Set(prev.map((t) => t.id))
      const storeOpenIds   = new Set(storeOps.filter((o) => o.status === 'OPEN').map((o) => o.id))
      const storeKnownIds  = new Set(storeOps.map((o) => o.id))

      // 1. Drop entries the store now reports as resolved/cancelled.
      //    Untouched if the store doesn't know the trade at all (fresh
      //    optimistic local trade — SSE will deliver shortly).
      const trimmed = prev.filter((t) => !storeKnownIds.has(t.id) || storeOpenIds.has(t.id))

      // 2. Add remote OPEN ops for the current asset that we don't yet have.
      const additions = storeOps
        .filter((o) => o.status === 'OPEN' && o.assetId === selectedAsset.id && !prevIds.has(o.id))
        .map((o) => ({
          id:         o.id,
          entryPrice: parseFloat(o.entryPrice ?? '0'),
          entryTime:  Math.floor(new Date(o.openedAt).getTime() / 1000) + BRT_OFFSET,
          expiryTime: Math.floor(new Date(o.expiresAt).getTime() / 1000) + BRT_OFFSET,
          direction:  o.direction,
          amount:     parseFloat(o.amount),
          payout:     o.payout,
        }))

      if (trimmed.length === prev.length && additions.length === 0) return prev
      return [...trimmed, ...additions]
    })
  }, [storeOps, selectedAsset.id])
  const binanceTicker = useBinanceTicker(selectedAsset.source === 'BINANCE' ? selectedAsset.marketSymbol : undefined)
  const displayPrice = binanceTicker?.price ?? selectedAsset.price
  // Signals to the chart whether `displayPrice` is fresh WS data (true)
  // or the stale static asset.price fallback (false). Lets the chart's
  // initial-sync logic distinguish "trust this price" from "ignore until
  // the WS arrives" — eliminates the load-time candle jump.
  const hasFreshTicker = binanceTicker != null

  function handleTradePlaced(trade: ChartTradeEvent | null) {
    // Legacy null call from TradingPanel's cleanup timeout is now redundant:
    // we handle per-trade cleanup ourselves via setTimeout below.
    if (!trade) return

    if (trade.status === 'OPEN') {
      setActiveTrades(prev => [
        ...prev.filter(t => t.id !== trade.id),
        {
          id:         trade.id,
          entryPrice: trade.entryPrice,
          entryTime:  trade.entryTime,
          expiryTime: trade.expiryTime,
          direction:  trade.direction,
          amount:     trade.amount,
          payout:     trade.payout,
        },
      ])
    } else if (trade.status === 'CANCELLED') {
      // Optimistic trade failed at the server — silently remove the marker.
      // Stake refund + balance reconciliation happen at the call site.
      setActiveTrades(prev => prev.filter(t => t.id !== trade.id))
    } else { // RESOLVED
      setActiveTrades(prev => prev.filter(t => t.id !== trade.id))
      // Persist the result card on the chart until the user clicks its X.
      // (Previously auto-dismissed after 4s — founder feedback: traders want
      // to keep the result visible while they analyse the next setup.)
      setChartTradeEvents(prev => [...prev.filter(t => t.id !== trade.id), trade])
    }

    // No refreshAccounts() — balance is now mutated locally by the trading
    // components via applyBalanceDelta. Next /auth/me revalidate (page reload
    // or stale-while-revalidate window) reconciles any drift.
  }

  const isDemo      = authStore.isDemo
  const accounts    = authStore.user?.accounts ?? []
  const demoBalance = parseFloat(accounts.find(a => a.type === 'DEMO')?.balance ?? '0')
  const realBalance = parseFloat(accounts.find(a => a.type === 'REAL')?.balance ?? '0')
  const balance     = isDemo ? demoBalance : realBalance

  // Mobile-header level icon — same logic as desktop Header.tsx. The
  // `mounted` gate avoids a hydration mismatch: SSR has realBalance=0
  // (no auth on the server), client may render the persisted balance.
  // Both render PADRÃO until mounted, then swap to the real level.
  const [headerMounted, setHeaderMounted] = useState(false)
  useEffect(() => { setHeaderMounted(true) }, [])
  const level = getAccountLevel(headerMounted ? realBalance : 0)

  function handleSelectAsset(asset: Asset) {
    setSelectedAsset(asset)
    if (!openAssets.find((a) => a.id === asset.id)) {
      setOpenAssets((prev) => [...prev, asset])
    }
  }

  function handleCloseAsset(asset: Asset) {
    const remaining = openAssets.filter((a) => a.id !== asset.id)
    setOpenAssets(remaining)
    if (selectedAsset.id === asset.id && remaining.length > 0) {
      setSelectedAsset(remaining[remaining.length - 1])
    }
  }

  function handleSelectDemo() {
    if (!isDemo) { authStore.setIsDemo(true); setSwitchModal('demo') }
  }

  function handleSelectReal() {
    if (isDemo) { authStore.setIsDemo(false); setSwitchModal('real') }
  }

  // ─── Shared content renderers ──────────────────────────────────────────────

  function renderMainContent(isMobile = false) {
    if (sidebarTab === 'SUPORTE') {
      // On mobile the user opens Suporte to read tickets and type replies —
      // the chart is irrelevant there and would only steal vertical space.
      // Show the panel full-screen, same UX pattern as CONTA.
      if (isMobile) return <SupportPanel onClose={() => setSidebarTab('TRADE')} />
      return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <SupportPanel onClose={() => setSidebarTab('TRADE')} />
          <TradingChart asset={selectedAsset} marketPrice={displayPrice} hasFreshTicker={hasFreshTicker} onInfoClick={() => setAssetInfoOpen(true)} theme={theme} autoScroll={tradeSettings.autoScroll} performanceMode={tradeSettings.performanceMode} activeTrades={activeTrades} chartTradeEvents={chartTradeEvents} />
        </div>
      )
    }
    if (sidebarTab === 'CONTA')     return <ContaPage key={contaInitialTab} initialTab={contaInitialTab} onClose={() => setSidebarTab('TRADE')} />
    if (sidebarTab === 'HISTORICO') {
      // On mobile the user wants to scan their full history — chart on top
      // would steal vertical space. Show the panel full-screen, matching
      // the SUPORTE/CONTA pattern.
      if (isMobile) return <HistoricoPanel onClose={() => setSidebarTab('TRADE')} isDemo={authStore.isDemo} />
      return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <HistoricoPanel onClose={() => setSidebarTab('TRADE')} isDemo={authStore.isDemo} />
          <TradingChart asset={selectedAsset} marketPrice={displayPrice} hasFreshTicker={hasFreshTicker} onInfoClick={() => setAssetInfoOpen(true)} theme={theme} autoScroll={tradeSettings.autoScroll} performanceMode={tradeSettings.performanceMode} activeTrades={activeTrades} chartTradeEvents={chartTradeEvents} />
        </div>
      )
    }
    if (sidebarTab === 'RANKING') {
      // Same mobile-vs-desktop split as HISTORICO / SUPORTE: on mobile show
      // only the panel, on desktop pair it with the chart.
      if (isMobile) return <RankingPanel onClose={() => setSidebarTab('TRADE')} userName={authStore.user?.name} userCode="br" />
      return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <RankingPanel onClose={() => setSidebarTab('TRADE')} userName={authStore.user?.name} userCode="br" />
          <TradingChart asset={selectedAsset} marketPrice={displayPrice} hasFreshTicker={hasFreshTicker} onInfoClick={() => setAssetInfoOpen(true)} theme={theme} autoScroll={tradeSettings.autoScroll} performanceMode={tradeSettings.performanceMode} activeTrades={activeTrades} chartTradeEvents={chartTradeEvents} />
        </div>
      )
    }
    if (sidebarTab === 'BONUS') {
      // Card CTA opens the deposit modal with the bonus code pre-applied.
      const openWithBonus = (code: string) => {
        setDepositoBonusCode(code)
        setDepositoOpen(true)
      }
      if (isMobile) return <BonusPanel onClose={() => setSidebarTab('TRADE')} onDeposit={openWithBonus} />
      return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <BonusPanel onClose={() => setSidebarTab('TRADE')} onDeposit={openWithBonus} />
          <TradingChart asset={selectedAsset} marketPrice={displayPrice} hasFreshTicker={hasFreshTicker} onInfoClick={() => setAssetInfoOpen(true)} theme={theme} autoScroll={tradeSettings.autoScroll} performanceMode={tradeSettings.performanceMode} activeTrades={activeTrades} chartTradeEvents={chartTradeEvents} />
        </div>
      )
    }
    if (sidebarTab === 'COPY')      return <ComingSoon title="Copy Trading" message="Em breve você poderá copiar automaticamente as melhores operações de traders profissionais." onClose={() => setSidebarTab('TRADE')} />

    // TRADE (default)
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {!isMobile && configOpen && (
          <ConfiguracoesPanel onClose={() => setConfigOpen(false)} theme={theme} onThemeChange={setTheme} settings={tradeSettings} onSettingsChange={setTradeSettings} />
        )}
        <TradingChart asset={selectedAsset} marketPrice={displayPrice} hasFreshTicker={hasFreshTicker} onInfoClick={() => setAssetInfoOpen(true)} theme={theme} autoScroll={tradeSettings.autoScroll} performanceMode={tradeSettings.performanceMode} activeTrades={activeTrades} chartTradeEvents={chartTradeEvents} />
        {!isMobile && <TradingPanel asset={selectedAsset} marketPrice={displayPrice} shortLabels={tradeSettings.shortLabels} accountId={currentAccount?.id} onTradePlaced={handleTradePlaced} />}
      </div>
    )
  }

  return (
    <div className="h-full bg-[#151822] overflow-hidden">

      {/* ── DESKTOP layout (md+) ─────────────────────────────────────────── */}
      <div className="hidden md:flex h-full overflow-hidden">
        <Sidebar activeTab={sidebarTab} onTabChange={setSidebarTab} onSettings={() => setConfigOpen(!configOpen)} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header
            selectedAsset={selectedAsset}
            onSelectAsset={handleSelectAsset}
            openAssets={openAssets}
            onOpenAsset={handleSelectAsset}
            onCloseAsset={handleCloseAsset}
            onOpenSelector={() => setAssetSelectorOpen(true)}
            onDeposito={() => setDepositoOpen(true)}
            onRetirada={() => { setContaInitialTab('retirada'); setSidebarTab('CONTA') }}
            onTransacoes={() => { setContaInitialTab('minha-conta'); setSidebarTab('CONTA') }}
            onOperacoes={() => setSidebarTab('TRADE')}
            onMinhaConta={() => { setContaInitialTab('minha-conta'); setSidebarTab('CONTA') }}
            onNiveis={() => setNiveisOpen(true)}
            onLogout={() => { authStore.logout().then(() => router.replace('/login')) }}
            onResetDemo={() => authStore.resetDemo()}
            isDemo={isDemo}
            onSelectDemo={handleSelectDemo}
            onSelectReal={handleSelectReal}
            demoBalance={demoBalance}
            realBalance={realBalance}
            balance={balance}
            userEmail={authStore.user?.email ?? ''}
            userId={authStore.user?.id ?? ''}
          />
          <div className="flex-1 flex min-h-0 overflow-hidden relative">
            {renderMainContent(false)}
          </div>
        </div>
      </div>

      {/* ── MOBILE layout (< md) ─────────────────────────────────────────── */}
      <div className="flex md:hidden h-full flex-col overflow-hidden">

        {/* Mobile header — taller (h-14 vs the previous h-12) so the
            balance chip + deposit CTA have proper tap targets and
            breathing room. */}
        <header className="flex items-center justify-between gap-2 px-4 h-14 bg-[#1d2130] border-b border-[#2a2e3b] flex-shrink-0">
          {/* Logo */}
          <div className="flex-shrink min-w-0">
            <Logo size="sm" />
          </div>


          {/* Right: balance + deposit */}
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Balance chip — shrinks if needed; h-10 sets a consistent
                size with the deposit button alongside it.
                suppressHydrationWarning: isDemo comes from the auth store
                which rehydrates from localStorage on the client only.
                Server renders the default (DEMO) icon; client may render
                the persisted (REAL) icon. The diff is intentional. */}
            <div className="relative min-w-0">
              <button
                onClick={() => setMobileAccountOpen(v => !v)}
                className="flex items-center gap-1.5 h-10 px-2.5 rounded-lg bg-[#252a3a] border border-[#2a2e3b] max-w-full"
                suppressHydrationWarning
              >
                {isDemo
                  ? <GraduationCap size={18} className="text-yellow-400 flex-shrink-0" />
                  : <level.Icon size={18} className={cn(level.color, 'flex-shrink-0')} />
                }
                <div className="text-left min-w-0">
                  <div className={cn('text-[10px] font-bold leading-tight whitespace-nowrap', isDemo ? 'text-yellow-400' : 'text-green-400')}>
                    {isDemo ? 'CONTA DEMO' : 'CONTA REAL'}
                  </div>
                  <div className="text-sm font-bold text-white leading-tight whitespace-nowrap">
                    R${balance.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <ChevronDown size={12} className={cn('text-[#8b8f9a] transition-transform flex-shrink-0', mobileAccountOpen && 'rotate-180')} />
              </button>

              {mobileAccountOpen && (
                <div className="absolute top-full right-0 mt-1 z-50">
                  <AccountDropdown
                    isDemo={isDemo}
                    onSelectDemo={() => { handleSelectDemo(); setMobileAccountOpen(false) }}
                    onSelectReal={() => { handleSelectReal(); setMobileAccountOpen(false) }}
                    demoBalance={demoBalance}
                    realBalance={realBalance}
                    userEmail={authStore.user?.email ?? ''}
                    userId={authStore.user?.id ?? ''}
                    onClose={() => setMobileAccountOpen(false)}
                    onLogout={() => { authStore.logout().then(() => router.replace('/login')) }}
                    onResetDemo={() => authStore.resetDemo()}
                    onDeposito={() => { setDepositoOpen(true); setMobileAccountOpen(false) }}
                    onRetirada={() => { setContaInitialTab('retirada'); setSidebarTab('CONTA'); setMobileAccountOpen(false) }}
                    onTransacoes={() => { setContaInitialTab('minha-conta'); setSidebarTab('CONTA'); setMobileAccountOpen(false) }}
                    onOperacoes={() => { setSidebarTab('TRADE'); setMobileAccountOpen(false) }}
                    onMinhaConta={() => { setContaInitialTab('minha-conta'); setSidebarTab('CONTA'); setMobileAccountOpen(false) }}
                    onNiveis={() => { setNiveisOpen(true); setMobileAccountOpen(false) }}
                  />
                </div>
              )}
            </div>

            {/* Deposit — text hides on very narrow screens (< 380px).
                h-10 matches the balance chip alongside for a consistent
                row height on the new (taller) mobile header. */}
            <button
              onClick={() => setDepositoOpen(true)}
              className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-green-500 hover:bg-green-400 text-sm font-bold text-white transition-colors flex-shrink-0"
            >
              <Plus size={15} strokeWidth={2.5} />
              <span className="hidden min-[380px]:inline">Depósito</span>
            </button>
          </div>
        </header>

        {/* Main content area */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {renderMainContent(true)}
        </div>

        {/* Mobile compact trading card (always visible on TRADE tab) */}
        {sidebarTab === 'TRADE' && (
          <TradingCompactCard
            asset={selectedAsset}
            marketPrice={displayPrice}
            accountId={currentAccount?.id}
            onOpenSelector={() => setAssetSelectorOpen(true)}
            onTradePlaced={handleTradePlaced}
          />
        )}

        {/* Mobile bottom navigation */}
        <MobileNav activeTab={sidebarTab} onTabChange={setSidebarTab} />
      </div>

      {/* ── Global modals (shared desktop + mobile) ──────────────────────── */}
      {niveisOpen && (
        <NiveisModal realBalance={realBalance} onClose={() => setNiveisOpen(false)} />
      )}
      {assetSelectorOpen && (
        <AssetSelectorModal selectedAsset={selectedAsset} assets={assets} onSelect={handleSelectAsset} onClose={() => setAssetSelectorOpen(false)} />
      )}
      {assetInfoOpen && (
        <AssetInfoModal asset={selectedAsset} marketPrice={displayPrice} onClose={() => setAssetInfoOpen(false)} onTrade={() => setAssetInfoOpen(false)} />
      )}
      {depositoOpen && (
        <DepositoModal
          onClose={() => { setDepositoOpen(false); setDepositoBonusCode(undefined) }}
          initialBonusCode={depositoBonusCode}
        />
      )}
      {switchModal && (
        <AccountSwitchModal switchedTo={switchModal} demoBalance={demoBalance} realBalance={realBalance} onClose={() => setSwitchModal(null)} />
      )}

      {/* Welcome bonus — opens once per session AFTER auth hydrates.
          Self-dismisses on X, backdrop click, or "Depositar agora" (which
          also pre-fills the deposit modal with the bonus code). */}
      <BonusWelcomeModal
        enabled={!!authStore.user && !authStore.loading}
        onDeposit={(code) => { setDepositoBonusCode(code); setDepositoOpen(true) }}
      />
    </div>
  )
}

function ComingSoon({ title, message, onClose }: { title: string; message: string; onClose?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center bg-[#151822] relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
          title="Fechar"
        >
          <X size={16} />
        </button>
      )}
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-400/20 border border-blue-500/30 flex items-center justify-center mb-5">
        <span className="text-2xl">🚀</span>
      </div>
      <h2 className="text-white text-xl font-bold mb-2">{title}</h2>
      <p className="text-[#8b8f9a] text-sm max-w-md leading-relaxed">{message}</p>
      <span className="mt-6 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[10px] font-bold tracking-widest uppercase">
        Em breve
      </span>
    </div>
  )
}
