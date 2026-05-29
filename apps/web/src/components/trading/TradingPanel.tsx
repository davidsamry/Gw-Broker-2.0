'use client'

import { useState, useEffect, useMemo } from 'react'
import { Minus, Plus, ArrowUp, ArrowDown, ChevronUp, Package, X } from 'lucide-react'
import { ASSETS, type Asset, type OpenTrade, type ClosedTrade, type ActiveTrade, type ChartTradeEvent } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { FlagPair } from '@/components/ui/FlagPair'
import { api } from '@/lib/api'
import { useOperationsStore, type ApiOperation } from '@/store/operations'
import { useAuthStore } from '@/store/auth'
import { getAssetMarket, isMarketAllowed } from '@/lib/marketPermissions'
import { useOtcLivePrice } from '@/lib/otcMarket'
import { useBinanceTicker } from '@/lib/binanceMarket'

interface TradingPanelProps {
  asset: Asset
  shortLabels?: boolean
  mobile?: boolean
  compact?: boolean  // hides the asset header + open/closed trades list
  accountId?: string
  marketPrice?: number
  onTradePlaced?: (trade: ChartTradeEvent | null) => void
  // Click on a pending trade card → switch the chart to that asset.
  // When the trade is already for the on-screen asset, the click toggles
  // the inline x2/Vender actions instead (legacy behavior preserved).
  onSelectAsset?: (asset: Asset) => void
}

// Durações em segundos — correspondem aos horários absolutos exibidos como no Quotex
const TIME_OPTIONS = [60, 300, 900]
const MIN_INVESTMENT = 10

const BRT_OFFSET = -3 * 3600 // UTC-3 (Horário de Brasília)

function durationLabel(duration: number) {
  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function fmtMoney(v: number) {
  return v.toLocaleString('en-US')
}

function FloatingBox({ label, link, children }: {
  label: string
  link?: string
  children: React.ReactNode
}) {
  return (
    <div className="px-3 pt-3 pb-1">
      <div className="relative border border-[#2a2e3b] rounded-lg px-3 py-2.5">
        <span className="absolute -top-[9px] left-3 px-1 text-[10px] font-medium text-[#8b8f9a] bg-[#1d2130]">
          {label}
        </span>
        {children}
      </div>
      {link && (
        <p className="text-center mt-1">
          <button className="text-[10px] font-bold text-blue-400 hover:text-blue-300 tracking-widest transition-colors">
            {link}
          </button>
        </p>
      )}
    </div>
  )
}

function TradeItem({
  trade, shortLabels, currentAssetId, onSelectAsset,
}: {
  trade:          OpenTrade
  shortLabels:    boolean
  currentAssetId: string
  onSelectAsset?: (asset: Asset) => void
}) {
  // Click on a pending-trade card → switch the chart to that asset.
  // No-op if the card already represents the on-screen asset (avoids
  // an unnecessary re-render of TradingChart).
  const isCurrent = trade.asset.id === currentAssetId

  // Regressive countdown synchronized with the chart marker:
  // both use `expiryTime - (Date.now()/1000 + BRT_OFFSET)`.
  const [remaining, setRemaining] = useState(() => Math.max(0, trade.expiryTime - (Math.floor(Date.now() / 1000) + BRT_OFFSET)))

  useEffect(() => {
    const tick = () => {
      const nowBrt = Math.floor(Date.now() / 1000) + BRT_OFFSET
      setRemaining(Math.max(0, trade.expiryTime - nowBrt))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [trade.expiryTime])

  // Live P&L — subscribes to the same price feed the chart uses so the
  // row updates in real time. Hooks must be called unconditionally, so
  // we pass null/undefined to the ones that don't match this asset.
  const isBinance      = trade.asset.source === 'BINANCE'
  const otcLivePrice   = useOtcLivePrice(isBinance ? null : trade.asset.id)
  const binanceTicker  = useBinanceTicker(isBinance ? trade.asset.marketSymbol : undefined)
  const currentPrice   = isBinance
    ? (binanceTicker?.price ?? trade.entryPrice)
    : (otcLivePrice ?? trade.entryPrice)

  // Binary option settlement: CALL wins if price ABOVE entry, PUT wins
  // if BELOW. Tie (==) is a loss server-side, but while open we show 0
  // — easier on the eyes than flashing -R$ when ticks land exactly on
  // entry. Final result is decided at expiry by the operations worker.
  const pnlIsLive = trade.direction === 'CALL'
    ? currentPrice > trade.entryPrice
    : currentPrice < trade.entryPrice
  const pnlIsTied = currentPrice === trade.entryPrice
  const pnl       = pnlIsTied ? 0 : pnlIsLive ? trade.amount * (trade.asset.payout / 100) : -trade.amount
  const pnlSign   = pnl > 0 ? '+' : ''

  const m = Math.floor(remaining / 60).toString().padStart(2, '0')
  const s = (remaining % 60).toString().padStart(2, '0')

  const name = trade.asset.label.length > 13 ? trade.asset.label.slice(0, 13) + '...' : trade.asset.label

  return (
    <div className="px-2 mb-px">
      <div
        className="px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
        onClick={() => {
          if (!isCurrent && onSelectAsset) onSelectAsset(trade.asset)
        }}
        title={isCurrent ? undefined : `Abrir gráfico de ${trade.asset.label}`}
      >
        <div className="flex items-center gap-1.5">
          <FlagPair code1={trade.asset.code1} code2={trade.asset.code2} size={15} />
          <span className="flex-1 text-[12px] font-semibold text-white truncate">
            {shortLabels ? name : trade.asset.label}
          </span>
          <span className={cn(
            'text-[11px] font-mono font-bold flex-shrink-0',
            remaining <= 10 ? 'text-red-400' : remaining <= 30 ? 'text-yellow-400' : 'text-[#8b8f9a]'
          )}>
            {m}:{s}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 pl-5">
          <span className={cn(
            'w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0',
            trade.direction === 'CALL' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          )}>
            {trade.direction === 'CALL'
              ? <ArrowUp size={9} strokeWidth={3} />
              : <ArrowDown size={9} strokeWidth={3} />}
          </span>
          <span className="text-[11px] text-[#8b8f9a] flex-1">R$ {fmtMoney(trade.amount)}</span>
          <span className={cn(
            'text-[11px] font-bold',
            pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-[#8b8f9a]',
          )}>
            {pnlSign}R$ {pnl.toFixed(2).replace('.', ',')}
          </span>
        </div>
      </div>
    </div>
  )
}

function ClosedTradeItem({ trade }: { trade: ClosedTrade }) {
  const time = new Date(trade.closedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const won  = trade.status === 'WON'
  const net  = won ? trade.profit : -trade.amount
  const sign = net > 0 ? '+' : ''

  return (
    <div className="px-2 mb-px">
      <div className="px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-1.5">
          <FlagPair code1={trade.code1} code2={trade.code2} size={15} />
          <span className="flex-1 text-[12px] font-semibold text-white truncate">
            {trade.assetSymbol}
          </span>
          <span className="text-[10px] font-mono text-[#8b8f9a] flex-shrink-0">{time}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 pl-5">
          <span className={cn(
            'w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0',
            trade.direction === 'CALL' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          )}>
            {trade.direction === 'CALL'
              ? <ArrowUp size={9} strokeWidth={3} />
              : <ArrowDown size={9} strokeWidth={3} />}
          </span>
          <span className="text-[11px] text-[#8b8f9a] flex-1">R$ {fmtMoney(trade.amount)}</span>
          <span className={cn(
            'text-[11px] font-bold',
            won ? 'text-green-400' : 'text-red-400'
          )}>
            {sign}R$ {net.toFixed(2).replace('.', ',')}
          </span>
        </div>
      </div>
    </div>
  )
}

export function TradingPanel({ asset, shortLabels = true, mobile = false, compact = false, accountId, marketPrice, onTradePlaced, onSelectAsset }: TradingPanelProps) {
  const [investment, setInvestment] = useState(10)
  const [investmentRaw, setInvestmentRaw] = useState('')
  const [editingInvestment, setEditingInvestment] = useState(false)
  const [timeIndex, setTimeIndex] = useState(0) // 60s = 1 min (padrão)
  const [timerPickerOpen, setTimerPickerOpen] = useState(false)
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([])
  const [placing, setPlacing] = useState(false)
  const [tradeError, setTradeError] = useState('')
  const [tradeResult, setTradeResult] = useState<{ direction: 'CALL' | 'PUT'; amount: number; profit: number; won: boolean } | null>(null)

  // Reactive read of the logged-in user — needed for market-permission
  // gate below. Subscribing to the slice means an admin-flipped flag
  // re-renders this panel on the next /auth/me revalidate.
  const user = useAuthStore((s) => s.user)
  const market = getAssetMarket(asset)
  const marketAllowed = isMarketAllowed(user ?? undefined, market)

  // Closed-trades come from the shared operations store (hydrated by /auth/me
  // on app mount). When a trade resolves, placeTrade upserts the new op into
  // the same store — this list updates automatically via useMemo.
  const storeOperations = useOperationsStore((s) => s.operations)
  const closedTrades: ClosedTrade[] = useMemo(
    () => storeOperations
      .filter((o) => o.status === 'WON' || o.status === 'LOST' || o.status === 'CANCELLED')
      .slice(0, 30)
      .map((o) => {
        const a = ASSETS.find((x) => x.id === o.assetId)
        const parts = o.assetId.split('-')
        return {
          id:          o.id,
          assetSymbol: a?.symbol ?? o.assetSymbol,
          code1:       a?.code1 ?? parts[0] ?? '',
          code2:       a?.code2 ?? parts[1] ?? '',
          direction:   o.direction,
          amount:      Number(o.amount),
          profit:      Number(o.profit ?? 0),
          status:      o.status as ClosedTrade['status'],
          closedAt:    o.closedAt ?? o.expiresAt,
        }
      }),
    [storeOperations],
  )

  // Remote OPEN trades — ops that landed in the store via /operations/stream
  // SSE (placed on another device or by a bot through /bot/v1/trade) but
  // aren't yet in the local `openTrades` (which only tracks trades placed
  // on THIS tab). Deduped by id so a trade placed locally — whose id was
  // promoted from clientTradeId → serverOpId after POST — only renders once.
  const remoteOpenTrades: OpenTrade[] = useMemo(() => {
    const localIds = new Set(openTrades.map((t) => t.id))
    return storeOperations
      .filter((o) => o.status === 'OPEN' && !localIds.has(o.id))
      .map((o) => {
        const asset = ASSETS.find((x) => x.id === o.assetId)
          ?? {
            id:        o.assetId,
            symbol:    o.assetSymbol || o.assetId,
            label:     o.assetSymbol || o.assetId,
            type:      'OTC' as const,
            category:  'Moedas' as const,
            payout:    o.payout,
            payout5min: o.payout,
            flag1: '', flag2: '',
            code1: '', code2: '',
            price: 0, change24h: 0,
          }
        return {
          id:         o.id,
          asset,
          direction:  o.direction,
          amount:     Number(o.amount),
          profit:     0,
          timeLeft:   0,
          entryPrice: Number(o.entryPrice ?? 0),
          // expiryTime stored as BRT-shifted epoch seconds (-3h). Matches
          // what placeTrade computes for local trades so TradeItem's
          // countdown uses one formula for both.
          expiryTime: Math.floor(new Date(o.expiresAt).getTime() / 1000) + BRT_OFFSET,
        }
      })
  }, [storeOperations, openTrades])

  // Final list rendered as PENDENTES.
  const allOpenTrades: OpenTrade[] = useMemo(
    () => [...openTrades, ...remoteOpenTrades],
    [openTrades, remoteOpenTrades],
  )

  // Live price for entry/UI. Falls through marketPrice → OTC →
  // static asset.price. All hooks must be called unconditionally — the
  // ones for sources that don't apply receive null/undefined and return
  // null cheaply (no SSE connection opens).
  const otcLivePrice = useOtcLivePrice(asset.source === 'BINANCE' ? null : asset.id)
  const livePrice    = marketPrice ?? otcLivePrice ?? asset.price
  const payout       = asset.payout / 100
  const payment      = Math.round(investment + investment * payout)

  function commitInvestment(raw: string) {
    const num = parseFloat(raw.replace(/[^0-9.]/g, ''))
    if (!isNaN(num) && num >= MIN_INVESTMENT) setInvestment(Math.round(num))
    setEditingInvestment(false)
  }

  async function placeTrade(direction: 'CALL' | 'PUT') {
    if (!accountId) return
    setTradeError('')

    // ── Pre-check balance ───────────────────────────────────────────────────
    // Avoid the optimistic-debit / refund bounce when the server is going to
    // refuse anyway. Show the error immediately, don't even POST.
    const myAccount = useAuthStore.getState().user?.accounts.find((a) => a.id === accountId)
    const balance   = parseFloat(myAccount?.balance ?? '0')
    if (balance < investment) {
      setTradeError('Saldo insuficiente.')
      return
    }

    setPlacing(true)

    // ── Optimistic UI ────────────────────────────────────────────────────────
    // Marker + open-trades row appear BEFORE the server roundtrip. The chart
    // identifies the trade by clientTradeId throughout; the real operationId
    // from the server is only used for the GET resolution call. On error we
    // roll back both lists + emit a CANCELLED event to silently remove the
    // marker.
    const expiresInSec  = TIME_OPTIONS[timeIndex]
    const entryTime     = Math.floor(Date.now() / 1000) + BRT_OFFSET
    const expiryTime    = entryTime + expiresInSec
    // entryPrice: BINANCE → livePrice (from external feed); OTC → live SSE
    // tick when available, falling back to static asset.price. The server
    // also re-derives the OTC entry from its own latest tick, so this is
    // the optimistic-UI mirror — usually agrees within one tick.
    const entryPrice    = asset.source === 'BINANCE' ? livePrice : (otcLivePrice ?? asset.price)
    const clientTradeId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const newTrade: OpenTrade = {
      id: clientTradeId,
      asset,
      direction,
      amount: investment,
      profit: 0,
      timeLeft: 0,
      entryPrice,
      expiryTime,
    }
    setOpenTrades(prev => [newTrade, ...prev])

    // Optimistically debit stake (mirrors what the server CTE does atomically)
    // — saves a /accounts RTT after the trade.
    useAuthStore.getState().applyBalanceDelta(accountId, -investment)

    onTradePlaced?.({
      id: clientTradeId,
      entryPrice,
      entryTime,
      expiryTime,
      direction,
      amount: investment,
      payout: asset.payout,
      status: 'OPEN',
    })

    try {
      const res = await api.post('/operations', {
        accountId,
        assetId:          asset.id,
        assetSymbol:      asset.label,
        // Backend needs this to fetch the real exit price from Binance at expiry.
        marketSymbol:     asset.source === 'BINANCE' ? asset.marketSymbol : undefined,
        direction,
        amount:           investment,
        payout:           asset.payout,
        entryPrice,
        expiresInSeconds: expiresInSec,
      })

      const operationId:   string = res.data?.operation?.id ?? res.data?.id ?? clientTradeId
      // Authoritative server expiresAt — anchor the timer to wall-clock,
      // not "duration since now()", so we don't drift by the POST latency.
      const serverOp:      any    = res.data?.operation ?? res.data
      const serverExpiryMs: number = serverOp?.expiresAt
        ? new Date(serverOp.expiresAt).getTime()
        : (Date.now() + expiresInSec * 1000)
      const delayMs = Math.max(0, serverExpiryMs - Date.now())

      // Promote the local optimistic trade's id to the server-issued one
      // so that the SSE 'created' event (also keyed by server id) gets
      // deduped against this row instead of rendering as a duplicate.
      setOpenTrades(prev => prev.map(t => t.id === clientTradeId ? { ...t, id: operationId } : t))

      // Same promotion for the chart marker living in page.tsx's
      // activeTrades. Without this, the SSE 'created' event (which the
      // parent's useEffect upserts keyed by the server uuid) would add
      // a SECOND marker — the user reports it as "1 click → 2 trades
      // on chart". `replacesId` tells handleTradePlaced to RENAME the
      // existing local-* entry instead of appending a new uuid entry.
      onTradePlaced?.({
        id:         operationId,
        replacesId: clientTradeId,
        entryPrice,
        entryTime,
        expiryTime,
        direction,
        amount:     investment,
        payout:     asset.payout,
        status:     'OPEN',
      })

      // Schedule result popup at the EXACT server expiry. GETs the real
      // operationId, but emits chart events keyed by clientTradeId
      // (matches the OPEN above). If the first GET races the backend
      // resolver and returns status='OPEN', retry up to 5× × 300ms —
      // covers the worst case even though backend now JIT-resolves.
      setTimeout(async () => {
        try {
          let operation: any = null
          for (let attempt = 0; attempt < 6; attempt++) {
            const { data } = await api.get(`/operations/${operationId}`)
            operation = data?.operation ?? data
            if (operation?.status === 'WON' || operation?.status === 'LOST' || operation?.status === 'CANCELLED') break
            await new Promise(r => setTimeout(r, 300))
          }
          const won = operation?.status === 'WON'
          const profit = won ? parseFloat(operation?.profit ?? '0') : 0

          const resolvedTrade: ChartTradeEvent = {
            // Key by the server uuid (operationId), NOT clientTradeId. The
            // chart's chartTradeEvents dedupes by id, and the parent's
            // useEffect on storeOps ALSO pushes a 'resolved' event keyed
            // by uuid when the SSE arrives — so if we'd kept clientTradeId
            // here, the two would have different ids and BOTH would render
            // as separate result cards (1 click → 2 cards on chart).
            // operationId here always matches the uuid the rest of the
            // pipeline uses, so dedup collapses to a single card.
            id: operationId,
            entryPrice,
            entryTime,
            expiryTime,
            direction,
            amount: investment,
            payout: asset.payout,
            status: 'RESOLVED',
            won,
            profit,
          }

          // ID was promoted from clientTradeId → operationId after the POST
          // returned, so filter by operationId here.
          setOpenTrades(prev => prev.filter(t => t.id !== operationId))
          // Credit winnings locally (stake + profit). Loss = no change since
          // stake was already debited on click.
          if (won) {
            useAuthStore.getState().applyBalanceDelta(accountId, investment + profit)
          }
          // Push the resolved op into the shared store — closedTrades is
          // derived from it via useMemo above, and HistoricoPanel reads the
          // same source.
          useOperationsStore.getState().upsertOne({
            id:          operationId,
            accountId,
            assetId:     asset.id,
            assetSymbol: asset.symbol,
            direction,
            amount:      String(investment),
            payout:      asset.payout,
            profit:      String(profit),
            status:      won ? 'WON' : 'LOST',
            entryPrice:  String(entryPrice),
            expiresAt:   operation?.expiresAt ?? new Date(expiryTime * 1000).toISOString(),
            openedAt:    operation?.openedAt ?? new Date(entryTime * 1000).toISOString(),
            closedAt:    operation?.closedAt ?? new Date().toISOString(),
          })
          onTradePlaced?.(resolvedTrade)
          setTradeResult({ direction, amount: investment, profit, won })
          setTimeout(() => onTradePlaced?.(null), 4000)
        } catch {
          setTradeError('Erro ao atualizar resultado da operação.')
          setOpenTrades(prev => prev.filter(t => t.id !== operationId))
          setTimeout(() => onTradePlaced?.(null), 4000)
        }
      }, delayMs)

    } catch (err: any) {
      // Server rejected — roll back the optimistic open trade + marker + refund.
      setOpenTrades(prev => prev.filter(t => t.id !== clientTradeId))
      useAuthStore.getState().applyBalanceDelta(accountId, investment)
      onTradePlaced?.({
        id: clientTradeId,
        entryPrice,
        entryTime,
        expiryTime,
        direction,
        amount: investment,
        payout: asset.payout,
        status: 'CANCELLED',
      })
      // Surface the actual server error so it's debuggable. Known codes get
      // a friendly Portuguese label; unknown codes fall through with the raw
      // identifier so we don't hide diagnostic info from the user.
      const code   = err.response?.data?.error as string | undefined
      const status = err.response?.status as number | undefined
      if      (code === 'INSUFFICIENT_BALANCE')    setTradeError('Saldo insuficiente.')
      else if (code === 'TOO_FAST' || status === 429) setTradeError('Aguarde alguns instantes antes de operar novamente.')
      else if (code === 'ACCOUNT_NOT_FOUND')       setTradeError('Conta não encontrada — recarregue a página.')
      else if (code === 'VALIDATION_ERROR')        setTradeError('Valor inválido (veja limites de Configurações).')
      else if (!err.response)                       setTradeError('Sem conexão com o servidor.')
      else                                          setTradeError(`Erro ao abrir operação${code ? ` (${code})` : ''}.`)
    } finally {
      setPlacing(false)
    }
  }

  const timeDisplay = durationLabel(TIME_OPTIONS[timeIndex])

  function adjustInvestment(delta: number) {
    setInvestment(v => Math.max(MIN_INVESTMENT, v + delta))
  }

  function adjustTime(delta: number) {
    setTimeIndex(i => Math.max(0, Math.min(TIME_OPTIONS.length - 1, i + delta)))
  }

  return (
    <aside className={cn(mobile ? 'w-full' : 'w-[280px] flex-shrink-0 border-l border-[#2a2e3b]', 'flex flex-col bg-[#1d2130] overflow-hidden')}>

      {/* Result is rendered pinned to the chart's expiry dot — see TradeResultMarker in TradingChart. */}

      {/* Asset header — hidden in compact mode (mobile sheet shows its own header) */}
      {!compact && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e3b]">
          <div className="flex items-center gap-2 min-w-0">
            <FlagPair code1={asset.code1} code2={asset.code2} size={20} />
            <span className="text-sm font-bold text-white truncate">{asset.label}</span>
          </div>
          <span className="text-base font-bold text-green-400 flex-shrink-0 ml-2">{asset.payout}%</span>
        </div>
      )}

      {/* Tempo */}
      <FloatingBox label="Tempo" link="TEMPO DE EXPIRAÇÃO">
        <div className="flex items-center gap-2">
          <button
            onClick={() => adjustTime(-1)}
            disabled={timeIndex === 0}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors disabled:opacity-30 flex-shrink-0"
          >
            <Minus size={14} />
          </button>

          {/* Horário absoluto de expiração — abre grid ao clicar */}
          <div className="flex-1 text-center relative">
            <button
              onClick={() => setTimerPickerOpen(v => !v)}
              className="text-xl font-bold text-white font-mono tracking-wider hover:text-blue-300 transition-colors w-full"
            >
              {timeDisplay}
            </button>

            {timerPickerOpen && (
              <div
                className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-[#1a1e2e] border border-[#2a2e3b] rounded-xl z-50 p-2 shadow-2xl"
                style={{ width: '240px' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="grid grid-cols-4 gap-1">
                  {TIME_OPTIONS.map((duration, i) => (
                    <button
                      key={duration}
                      onClick={() => { setTimeIndex(i); setTimerPickerOpen(false) }}
                      className={cn(
                        'py-1.5 text-[11px] font-bold rounded-lg transition-colors',
                        i === timeIndex
                          ? 'bg-blue-600 text-white'
                          : 'text-[#8b8f9a] hover:text-white hover:bg-white/5'
                      )}
                    >
                      {durationLabel(duration)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => adjustTime(1)}
            disabled={timeIndex === TIME_OPTIONS.length - 1}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors disabled:opacity-30 flex-shrink-0"
          >
            <Plus size={14} />
          </button>
        </div>
      </FloatingBox>

      {/* Investimento */}
      <FloatingBox label="Investimento" link="VALOR">
        <div className="flex items-center gap-2">
          <button
            onClick={() => adjustInvestment(-10)}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors flex-shrink-0"
          >
            <Minus size={14} />
          </button>
          <div className="flex-1 text-center">
            {editingInvestment ? (
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                value={investmentRaw}
                onChange={e => setInvestmentRaw(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => commitInvestment(investmentRaw)}
                onKeyDown={e => { if (e.key === 'Enter') commitInvestment(investmentRaw); if (e.key === 'Escape') setEditingInvestment(false) }}
                placeholder={String(MIN_INVESTMENT)}
                className="w-full bg-transparent text-base font-bold text-white text-center outline-none border-b border-blue-500 placeholder:text-white/30"
              />
            ) : (
              <button
                onClick={() => { setInvestmentRaw(''); setEditingInvestment(true) }}
                className="text-base font-bold text-white hover:text-blue-300 transition-colors w-full"
                title="Clique para editar"
              >
                R$ {fmtMoney(investment)}
              </button>
            )}
          </div>
          <button
            onClick={() => adjustInvestment(10)}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-[#3a3f50] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors flex-shrink-0"
          >
            <Plus size={14} />
          </button>
        </div>
      </FloatingBox>

      {/* Lucro card */}
      <div className="px-3 pt-3 pb-2">
        <div className="border border-[#2a2e3b] rounded-lg px-3 py-2.5 text-center bg-[#171b27]/40">
          <div className="text-[10px] text-[#8b8f9a] font-semibold tracking-widest mb-1">
            RENTABILIDADE
          </div>
          <div className="text-[22px] font-extrabold text-green-400 leading-none">
            +{asset.payout}%
          </div>
          <div className="text-xs font-bold text-green-400 mt-1">
            +R$ {(investment * payout).toFixed(2).replace('.', ',')}
          </div>
        </div>
      </div>

      {/* CALL / PUT buttons — replaced by "Mercado Fechado" banner when
          the user's market permissions block trading on this asset's
          market. Asset still renders (chart, header, lists), only the
          place-trade actions are hidden — admin can revoke access mid-
          session and the user sees the change on next /auth/me sync. */}
      {marketAllowed ? (
        <div className="px-3 pt-3 pb-3 flex flex-col gap-2">
          <button
            onClick={() => placeTrade('CALL')}
            disabled={placing}
            className="w-full h-12 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] transition-all flex items-center justify-between px-5 font-bold text-white text-base shadow-lg shadow-green-900/30 disabled:opacity-50"
          >
            <span>Para cima</span>
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <ArrowUp size={16} strokeWidth={2.5} />
            </div>
          </button>
          <button
            onClick={() => placeTrade('PUT')}
            disabled={placing}
            className="w-full h-12 rounded-xl bg-red-500 hover:bg-red-400 active:scale-[0.98] transition-all flex items-center justify-between px-5 font-bold text-white text-base shadow-lg shadow-red-900/30 disabled:opacity-50"
          >
            <span>Para baixo</span>
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <ArrowDown size={16} strokeWidth={2.5} />
            </div>
          </button>
          {tradeError && <p className="text-red-400 text-xs text-center">{tradeError}</p>}
        </div>
      ) : (
        <div className="px-3 pt-3 pb-3">
          <div className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 flex flex-col items-center gap-1 text-center">
            <span className="text-base font-bold text-amber-300">Mercado Fechado</span>
            <span className="text-[11px] text-amber-200/80">
              Ativo indisponível para operações.
            </span>
          </div>
        </div>
      )}

      {/* Divider + operations list — hidden in compact (mobile) mode */}
      {!compact && (
        <>
          <div className="h-px bg-[#2a2e3b]" />

          <div className="flex-1 overflow-y-auto flex flex-col">
            {allOpenTrades.length === 0 && closedTrades.length === 0 ? (
              <EmptyState message="Não há operações abertas." />
            ) : (
              <>
                {allOpenTrades.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-4 py-1.5 mt-1">
                      <span className="text-[10px] font-bold text-[#8b8f9a] tracking-wide">PENDENTES</span>
                      <div className="w-5 h-5 rounded-full bg-blue-600/30 border border-blue-500/50 flex items-center justify-center">
                        <span className="text-[9px] font-bold text-white">{allOpenTrades.length}</span>
                      </div>
                    </div>
                    {allOpenTrades.map((trade) => (
                      <TradeItem
                        key={trade.id}
                        trade={trade}
                        shortLabels={shortLabels}
                        currentAssetId={asset.id}
                        onSelectAsset={onSelectAsset}
                      />
                    ))}
                  </>
                )}

                {closedTrades.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-4 py-1.5 mt-2 border-t border-[#2a2e3b]/60 pt-2">
                      <span className="text-[10px] font-bold text-[#8b8f9a] tracking-wide">FECHADAS</span>
                      <div className="w-5 h-5 rounded-full bg-[#252a3a] flex items-center justify-center">
                        <span className="text-[9px] font-bold text-white">{closedTrades.length}</span>
                      </div>
                    </div>
                    {closedTrades.map((trade) => (
                      <ClosedTradeItem key={trade.id} trade={trade} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          {/* Bottom chevron */}
          <div className="flex justify-center py-1.5 border-t border-[#2a2e3b] flex-shrink-0">
            <button className="text-[#3a3f50] hover:text-[#8b8f9a] transition-colors">
              <ChevronUp size={14} />
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
      <div className="w-14 h-14 rounded-full bg-[#252a3a] flex items-center justify-center mb-4">
        <Package size={24} className="text-[#8b8f9a]" />
      </div>
      <p className="text-[13px] text-[#8b8f9a] leading-relaxed whitespace-pre-line">{message}</p>
    </div>
  )
}
