'use client'

import { useState } from 'react'
import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react'
import { type Asset, type OpenTrade, type ChartTradeEvent } from '@/lib/mockData'
import { FlagPair } from '@/components/ui/FlagPair'
import { TradingInputsCompact } from './TradingInputsCompact'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'
import { useOtcLivePrice } from '@/lib/otcMarket'
import { alignExpirationToSlotClose } from '@/lib/expiration'
import { playSound } from '@/lib/sounds'

const TIME_OPTIONS = [
  { label: '01:00', value: 60   },
  { label: '05:00', value: 300  },
  { label: '15:00', value: 900  },
]
const MIN_INVESTMENT = 10
const BRT_OFFSET     = -3 * 3600

interface TradingCompactCardProps {
  asset:           Asset
  marketPrice?:    number
  accountId?:      string
  onOpenSelector?: () => void  // opens AssetSelectorModal
  onTradePlaced?:  (trade: ChartTradeEvent | null) => void
}

export function TradingCompactCard({
  asset, marketPrice, accountId, onOpenSelector, onTradePlaced,
}: TradingCompactCardProps) {
  const [investment, setInvestment] = useState(10)
  const [timeSec, setTimeSec]       = useState(60)
  const [placing, setPlacing]       = useState(false)
  const [tradeError, setTradeError] = useState('')

  // OTC live tick (null when asset is BINANCE or before first tick
  // arrives). When set, it overrides asset.price below so the entry
  // marker matches what the server will record. Fallthrough:
  // marketPrice → OTC → static asset.price.
  const otcLivePrice = useOtcLivePrice(asset.source === 'BINANCE' ? null : asset.id)
  const livePrice    = marketPrice ?? otcLivePrice ?? asset.price
  const payout       = asset.payout / 100
  const profit       = (investment * payout).toFixed(2).replace('.', ',')

  function adjustInvestment(delta: number) {
    setInvestment((v) => Math.max(MIN_INVESTMENT, v + delta))
  }

  async function placeTrade(direction: 'CALL' | 'PUT') {
    if (!accountId || placing) return
    setTradeError('')

    // ── Pre-check balance ───────────────────────────────────────────────────
    // Avoid the optimistic-debit / refund bounce when the server is going
    // to refuse anyway. Show the error immediately, don't even POST.
    const myAccount = useAuthStore.getState().user?.accounts.find((a) => a.id === accountId)
    const balance   = parseFloat(myAccount?.balance ?? '0')
    if (balance < investment) {
      setTradeError('Saldo insuficiente.')
      return
    }

    setPlacing(true)

    // ── Optimistic UI ────────────────────────────────────────────────────────
    // Render the marker AND debit the local balance BEFORE the server
    // roundtrip so the user sees feedback in <50ms instead of after the
    // ~700-1400ms POST latency. The chart marker uses `clientTradeId`
    // throughout its lifetime (OPEN → RESOLVED/CANCELLED); the real
    // `operationId` from the server is only used for the resolution GET.
    const clientTradeId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const nowMs         = Date.now()
    const entryTime     = Math.floor(nowMs / 1000) + BRT_OFFSET
    // Slot-close alignment MATCHES the server side — sem isso o marker
    // mobile apareceria com countdown de 60s e depois "saltaria" pro
    // valor real (ex: 30s) quando o POST voltasse. Mesma função usada
    // no TradingPanel desktop.
    const alignedExpiryMs = alignExpirationToSlotClose(nowMs, timeSec).getTime()
    const expiryTime    = Math.floor(alignedExpiryMs / 1000) + BRT_OFFSET
    // entryPrice: for BINANCE use livePrice; for OTC prefer the live SSE
    // tick (so client marker == server-recorded entry), fall back to the
    // static asset.price when the stream isn't available.
    const entryPrice    = asset.source === 'BINANCE' ? livePrice : (otcLivePrice ?? asset.price)

    // Optimistically debit the stake — server already does this atomically
    // in the create-operation CTE; we just mirror it client-side to avoid a
    // /accounts refetch.
    useAuthStore.getState().applyBalanceDelta(accountId, -investment)

    onTradePlaced?.({
      id: clientTradeId,
      entryPrice, entryTime, expiryTime,
      direction, amount: investment, payout: asset.payout,
      status: 'OPEN',
    })

    // Audio feedback — toca SEMPRE no clique (gesture user destrava
    // autoplay context). Falha silenciosa se autoplay bloqueado.
    playSound('open')

    try {
      const res = await api.post('/operations', {
        accountId,
        assetId:          asset.id,
        assetSymbol:      asset.label,
        marketSymbol:     asset.source === 'BINANCE' ? asset.marketSymbol : undefined,
        direction,
        amount:           investment,
        payout:           asset.payout,
        entryPrice,
        expiresInSeconds: timeSec,
      })

      const operationId: string = res.data?.operation?.id ?? clientTradeId
      // Authoritative server expiresAt. Usado pra (1) timer do
      // setTimeout abaixo e (2) corrigir o expiryTime do marker no
      // emit do replacesId (caso o clock skew local divergir do server).
      const serverOp:      any    = res.data?.operation ?? res.data
      const serverExpiryMs: number = serverOp?.expiresAt
        ? new Date(serverOp.expiresAt).getTime()
        : alignedExpiryMs
      const delayMs = Math.max(0, serverExpiryMs - Date.now())
      const serverExpiryTime = Math.floor(serverExpiryMs / 1000) + BRT_OFFSET

      // CRÍTICO: promove o marker otimista pro uuid do server. Sem isso,
      // o SSE 'created' chega com o uuid e o useEffect [storeOps] em
      // page.tsx ADICIONA um segundo marker porque o local-* ainda está
      // lá (= 2 markers visíveis pra 1 op). Esse é exatamente o bug
      // "no formato mobile esta bugado" reportado. TradingPanel desktop
      // já tinha esse emit; o CompactCard mobile estava sem.
      onTradePlaced?.({
        id:         operationId,
        replacesId: clientTradeId,
        entryPrice, entryTime,
        expiryTime: serverExpiryTime,
        direction, amount: investment, payout: asset.payout,
        status:     'OPEN',
      })

      // Poll for resolution after expiry, then signal the chart.
      // Uses real operationId for the GET, server uuid for chart events
      // (dedup com o useEffect [storeOps] que também push pela uuid).
      setTimeout(async () => {
        try {
          const { data } = await api.get(`/operations/${operationId}`)
          const op    = data?.operation ?? data
          const won   = op?.status === 'WON'
          const prof  = won ? parseFloat(op?.profit ?? '0') : 0
          // Credit winnings locally (stake + profit). Loss = no change since
          // stake was already debited on click.
          if (won) {
            useAuthStore.getState().applyBalanceDelta(accountId, investment + prof)
          }
          onTradePlaced?.({
            id: operationId,
            entryPrice, entryTime,
            expiryTime: serverExpiryTime,
            direction, amount: investment, payout: asset.payout,
            status: 'RESOLVED', won, profit: prof,
          })
          setTimeout(() => onTradePlaced?.(null), 4000)
        } catch {
          setTimeout(() => onTradePlaced?.(null), 4000)
        }
      }, delayMs)
    } catch (err: any) {
      // Server rejected — refund the optimistic debit + roll back marker.
      useAuthStore.getState().applyBalanceDelta(accountId, investment)
      onTradePlaced?.({
        id: clientTradeId,
        entryPrice, entryTime, expiryTime,
        direction, amount: investment, payout: asset.payout,
        status: 'CANCELLED',
      })
      // Same diagnostic mapping as TradingPanel — keep them in sync.
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

  return (
    <div className="flex-shrink-0 bg-[#1d2130] border-t border-[#2a2e3b] p-3 flex flex-col gap-3">
      {/* Asset row — clicking opens AssetSelectorModal */}
      <button
        onClick={onOpenSelector}
        className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-[#2a2e3b] bg-[#252a3a]/40 hover:border-blue-500/40 hover:bg-[#252a3a]/70 transition-all active:scale-[0.99]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FlagPair code1={asset.code1} code2={asset.code2} size={20} />
          <span className="text-sm font-bold text-white truncate">{asset.symbol}</span>
          <span className="text-sm font-bold text-green-400 flex-shrink-0">{asset.payout}%</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] font-bold text-white tracking-wide">RENTABILIDADE</span>
          <span className="text-[10px] font-bold text-green-400">+R$ {profit}</span>
          <ChevronDown size={14} className="text-[#8b8f9a]" />
        </div>
      </button>

      {/* Inputs row: cronômetro + investimento */}
      <TradingInputsCompact
        timeLabel={TIME_OPTIONS.find((t) => t.value === timeSec)?.label ?? '01:00'}
        timeOptions={TIME_OPTIONS}
        selectedTime={timeSec}
        onSelectTime={setTimeSec}
        investment={investment}
        minInvestment={MIN_INVESTMENT}
        onAdjustInvestment={adjustInvestment}
        onSetInvestment={setInvestment}
      />

      {/* CALL / PUT buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => placeTrade('CALL')}
          disabled={placing || !accountId}
          className="h-12 rounded-full bg-green-500 hover:bg-green-400 active:scale-[0.98] flex items-center justify-center gap-2 font-bold text-white text-sm transition-all shadow-lg shadow-green-900/30 disabled:opacity-50"
        >
          <span>Para cima</span>
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
            <ArrowUp size={13} strokeWidth={2.5} />
          </div>
        </button>
        <button
          onClick={() => placeTrade('PUT')}
          disabled={placing || !accountId}
          className="h-12 rounded-full bg-red-500 hover:bg-red-400 active:scale-[0.98] flex items-center justify-center gap-2 font-bold text-white text-sm transition-all shadow-lg shadow-red-900/30 disabled:opacity-50"
        >
          <span>Para baixo</span>
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
            <ArrowDown size={13} strokeWidth={2.5} />
          </div>
        </button>
      </div>

      {tradeError && (
        <p className="text-red-400 text-xs text-center -mt-1">{tradeError}</p>
      )}
    </div>
  )
}

// Re-export for places that previously imported OpenTrade from MobileTradingSheet (none currently, but safe).
export type { OpenTrade }
