'use client'

import { useState, useEffect } from 'react'
import { Minus, Plus, ArrowUp, ArrowDown, ChevronDown, ChevronUp, Package, X } from 'lucide-react'
import { type Asset, type OpenTrade, type ClosedTrade, type ActiveTrade, type ChartTradeEvent } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { FlagPair } from '@/components/ui/FlagPair'
import { api } from '@/lib/api'

interface TradingPanelProps {
  asset: Asset
  shortLabels?: boolean
  mobile?: boolean
  accountId?: string
  marketPrice?: number
  onTradePlaced?: (trade: ChartTradeEvent | null) => void
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

function TradeItem({ trade, shortLabels }: { trade: OpenTrade; shortLabels: boolean }) {
  // Regressive countdown synchronized with the chart marker:
  // both use `expiryTime - (Date.now()/1000 + BRT_OFFSET)`.
  const [remaining, setRemaining] = useState(() => Math.max(0, trade.expiryTime - (Math.floor(Date.now() / 1000) + BRT_OFFSET)))
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const tick = () => {
      const nowBrt = Math.floor(Date.now() / 1000) + BRT_OFFSET
      setRemaining(Math.max(0, trade.expiryTime - nowBrt))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [trade.expiryTime])

  const m = Math.floor(remaining / 60).toString().padStart(2, '0')
  const s = (remaining % 60).toString().padStart(2, '0')

  const name = trade.asset.label.length > 13 ? trade.asset.label.slice(0, 13) + '...' : trade.asset.label
  const earlyExitValue = Math.round(trade.amount * 0.2)

  return (
    <div className="px-2 mb-px">
      <div
        className="px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-1.5">
          <ChevronDown size={11} className={cn('text-[#8b8f9a] flex-shrink-0 transition-transform', expanded && 'rotate-180')} />
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
          <span className="text-[11px] text-[#8b8f9a] flex-1">{fmtMoney(trade.amount)} R$</span>
          <span className="text-[11px] font-bold text-[#8b8f9a]">
            0.00 R$
          </span>
        </div>
      </div>

      {expanded && (
        <div className="px-2 pb-2 flex gap-2">
          <button className="flex-1 h-7 rounded-lg bg-[#252a3a] border border-[#2a2e3b] text-[11px] font-bold text-white hover:border-blue-500/50 transition-colors">
            x2
          </button>
          <button className="flex-1 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-bold text-white transition-colors px-2">
            Vender agora &nbsp;{fmtMoney(earlyExitValue)} R$
          </button>
        </div>
      )}
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
          <span className="text-[11px] text-[#8b8f9a] flex-1">{fmtMoney(trade.amount)} R$</span>
          <span className={cn(
            'text-[11px] font-bold',
            won ? 'text-green-400' : 'text-red-400'
          )}>
            {sign}{net.toFixed(2).replace('.', ',')} R$
          </span>
        </div>
      </div>
    </div>
  )
}

export function TradingPanel({ asset, shortLabels = true, mobile = false, accountId, marketPrice, onTradePlaced }: TradingPanelProps) {
  const [investment, setInvestment] = useState(10)
  const [investmentRaw, setInvestmentRaw] = useState('')
  const [editingInvestment, setEditingInvestment] = useState(false)
  const [timeIndex, setTimeIndex] = useState(0) // 60s = 1 min (padrão)
  const [timerPickerOpen, setTimerPickerOpen] = useState(false)
  const [openTrades, setOpenTrades] = useState<OpenTrade[]>([])
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([])
  const [placing, setPlacing] = useState(false)
  const [tradeError, setTradeError] = useState('')
  const [tradeResult, setTradeResult] = useState<{ direction: 'CALL' | 'PUT'; amount: number; profit: number; won: boolean } | null>(null)

  // Load recent operations history on mount + when accountId changes.
  // Server returns up to 50 most-recent ops for the user.
  useEffect(() => {
    let cancelled = false
    if (!accountId) return
    api.get('/operations').then(({ data }) => {
      if (cancelled) return
      const ops = data?.operations ?? []
      const closed: ClosedTrade[] = ops
        .filter((o: any) => o.status === 'WON' || o.status === 'LOST' || o.status === 'CANCELLED')
        .slice(0, 30)
        .map((o: any) => ({
          id:          o.id,
          assetSymbol: o.assetSymbol,
          // Best-effort flag lookup: o.assetId is like "btc-usdt-binance" or "eur-jpy"
          code1:       (o.assetId.split('-')[0] ?? ''),
          code2:       (o.assetId.split('-')[1] ?? ''),
          direction:   o.direction,
          amount:      Number(o.amount),
          profit:      Number(o.profit ?? 0),
          status:      o.status,
          closedAt:    o.closedAt ?? o.expiresAt,
        }))
      setClosedTrades(closed)
    }).catch(() => { /* silent fail — empty list */ })
    return () => { cancelled = true }
  }, [accountId])

  const livePrice = marketPrice ?? asset.price
  const payout  = asset.payout / 100
  const payment = Math.round(investment + investment * payout)

  function commitInvestment(raw: string) {
    const num = parseFloat(raw.replace(/[^0-9.]/g, ''))
    if (!isNaN(num) && num >= MIN_INVESTMENT) setInvestment(Math.round(num))
    setEditingInvestment(false)
  }

  async function placeTrade(direction: 'CALL' | 'PUT') {
    if (!accountId) return
    setTradeError('')
    setPlacing(true)
    try {
      const expiresInSec = TIME_OPTIONS[timeIndex]
      const BRT_OFFSET = -3 * 3600
      const entryTime = Math.floor(Date.now() / 1000) + BRT_OFFSET
      const expiryTime = entryTime + expiresInSec

      const entryPrice = asset.source === 'BINANCE' ? livePrice : asset.price
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

      const operationId: string = res.data?.operation?.id ?? res.data?.id ?? `local-${Date.now()}`

      // Add to open trades list — expiryTime drives the regressive countdown in TradeItem
      const newTrade: OpenTrade = {
        id: operationId,
        asset,
        direction,
        amount: investment,
        profit: 0,
        timeLeft: 0,
        entryPrice,
        expiryTime,
      }
      setOpenTrades(prev => [newTrade, ...prev])

      // Signal chart to draw lines
      onTradePlaced?.({
        id: operationId,
        entryPrice,
        entryTime,
        expiryTime,
        direction,
        amount: investment,
        payout: asset.payout,
        status: 'OPEN',
      })

      // Schedule result popup after expiry
      setTimeout(async () => {
        try {
          const { data } = await api.get(`/operations/${operationId}`)
          const operation = data?.operation ?? data
          const won = operation?.status === 'WON'
          const profit = won ? parseFloat(operation?.profit ?? '0') : 0

          const resolvedTrade: ChartTradeEvent = {
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

          setOpenTrades(prev => prev.filter(t => t.id !== operationId))
          // Prepend to the closed-trades list so it appears at the top of "FECHADAS"
          setClosedTrades(prev => [
            {
              id:          operationId,
              assetSymbol: asset.label,
              code1:       asset.code1,
              code2:       asset.code2,
              direction,
              amount:      investment,
              profit,
              status:      won ? 'WON' : 'LOST',
              closedAt:    operation?.closedAt ?? new Date().toISOString(),
            },
            ...prev.filter(t => t.id !== operationId),
          ])
          onTradePlaced?.(resolvedTrade)
          setTradeResult({ direction, amount: investment, profit, won })
          setTimeout(() => onTradePlaced?.(null), 4000)
        } catch {
          setTradeError('Erro ao atualizar resultado da operação.')
          setOpenTrades(prev => prev.filter(t => t.id !== operationId))
          setTimeout(() => onTradePlaced?.(null), 4000)
        }
      }, expiresInSec * 1000)

    } catch (err: any) {
      const code = err.response?.data?.error
      if (code === 'INSUFFICIENT_BALANCE') setTradeError('Saldo insuficiente.')
      else setTradeError('Erro ao abrir operação.')
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

      {/* Asset header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e3b]">
        <div className="flex items-center gap-2 min-w-0">
          <FlagPair code1={asset.code1} code2={asset.code2} size={20} />
          <span className="text-sm font-bold text-white truncate">{asset.label}</span>
        </div>
        <span className="text-base font-bold text-green-400 flex-shrink-0 ml-2">{asset.payout}%</span>
      </div>

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
                {fmtMoney(investment)} R$
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

      {/* CALL / PUT buttons */}
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

      {/* Divider */}
      <div className="h-px bg-[#2a2e3b]" />

      {/* Operações */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {openTrades.length === 0 && closedTrades.length === 0 ? (
          <EmptyState message="Não há operações abertas." />
        ) : (
          <>
            {openTrades.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-4 py-1.5 mt-1">
                  <span className="text-[10px] font-bold text-[#8b8f9a] tracking-wide">PENDENTES</span>
                  <div className="w-5 h-5 rounded-full bg-blue-600/30 border border-blue-500/50 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-white">{openTrades.length}</span>
                  </div>
                </div>
                {openTrades.map((trade) => (
                  <TradeItem key={trade.id} trade={trade} shortLabels={shortLabels} />
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
