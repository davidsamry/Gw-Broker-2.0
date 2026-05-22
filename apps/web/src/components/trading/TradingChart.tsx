'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, ZoomIn, ZoomOut, Crosshair, ChevronDown, Eye, Pen, X, Activity } from 'lucide-react'
import { generateMockCandles, type Asset, type Candle, type ActiveTrade, type ChartTradeEvent } from '@/lib/mockData'
import { fetchBinanceCandles } from '@/lib/marketApi'
import { cn } from '@/lib/utils'
import { DrawingsPanel } from './DrawingsPanel'
import { IndicadoresPanel } from './IndicadoresPanel'

type ChartTheme = 'diurno' | 'crepusculo' | 'noite'
type ChartType = 'velas' | 'area' | 'barras' | 'heiken-ashi'

function alignToTimeframe(time: number, timeframeSeconds: number) {
  return Math.floor(time / timeframeSeconds) * timeframeSeconds
}

const THEME_COLORS: Record<ChartTheme, {
  bg: string; text: string; grid: string; border: string; crosshair: string; labelBg: string
}> = {
  noite:     { bg: '#151822', text: '#8b8f9a', grid: '#1e2333', border: '#2a2e3b', crosshair: '#4a5568', labelBg: '#2d3748' },
  diurno:    { bg: '#ffffff', text: '#374151', grid: '#e5e7eb', border: '#d1d5db', crosshair: '#9ca3af', labelBg: '#f3f4f6' },
  crepusculo:{ bg: '#1f1b2e', text: '#a78bfa', grid: '#2d2640', border: '#3d3554', crosshair: '#6d5eac', labelBg: '#2d2640' },
}

interface Timeframe { label: string; seconds: number }
const TIMEFRAMES: Timeframe[] = [
  { label: '5s',  seconds: 5    },
  { label: '15s', seconds: 15   },
  { label: '30s', seconds: 30   },
  { label: '1m',  seconds: 60   },
  { label: '5m',  seconds: 300  },
  { label: '15m', seconds: 900  },
  { label: '30m', seconds: 1800 },
  { label: '1h',  seconds: 3600 },
  { label: '4h',  seconds: 14400},
  { label: '1D',  seconds: 86400},
]

const BRT_OFFSET = -3 * 3600

const CHART_TYPES: { key: ChartType; label: string; icon: React.ReactNode }[] = [
  { key: 'area', label: 'Área', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <polyline points="1,12 5,7 9,9 13,3 15,5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <polygon points="1,12 5,7 9,9 13,3 15,5 15,13 1,13" fill="currentColor" opacity="0.3"/>
    </svg>
  )},
  { key: 'velas', label: 'Velas', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <line x1="4" y1="2" x2="4" y2="14" stroke="currentColor" strokeWidth="1"/>
      <rect x="2.5" y="5" width="3" height="5" fill="#26a69a"/>
      <line x1="11" y1="2" x2="11" y2="14" stroke="currentColor" strokeWidth="1"/>
      <rect x="9.5" y="7" width="3" height="5" fill="#ef5350"/>
    </svg>
  )},
  { key: 'barras', label: 'Barras', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <line x1="4" y1="3" x2="4" y2="13" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="2" y1="5" x2="4" y2="5" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="4" y1="9" x2="6" y2="9" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="11" y1="4" x2="11" y2="13" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="9" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="11" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )},
  { key: 'heiken-ashi', label: 'Heiken Ashi', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <line x1="4" y1="2" x2="4" y2="14" stroke="currentColor" strokeWidth="1"/>
      <rect x="2.5" y="4" width="3" height="7" fill="#26a69a"/>
      <line x1="11" y1="3" x2="11" y2="14" stroke="currentColor" strokeWidth="1"/>
      <rect x="9.5" y="6" width="3" height="6" fill="#ef5350"/>
    </svg>
  )},
]

interface TradingChartProps {
  asset: Asset
  marketPrice?: number
  onInfoClick: () => void
  theme?: ChartTheme
  autoScroll?: boolean
  performanceMode?: boolean
  activeTrade?: ActiveTrade | null
  chartTradeEvent?: ChartTradeEvent | null
}

const BINANCE_INTERVAL_BY_TIMEFRAME: Record<number, string> = {
  5: '1m',
  15: '1m',
  30: '1m',
  60: '1m',
  300: '5m',
  900: '15m',
  1800: '30m',
  3600: '1h',
  14400: '4h',
  86400: '1d',
}

function calculateSMA(candles: Candle[], period: number): { time: number; value: number }[] {
  return candles
    .map((c, i) => {
      if (i < period - 1) return null
      const avg = candles.slice(i - period + 1, i + 1).reduce((s, x) => s + x.close, 0) / period
      return { time: c.time as number, value: parseFloat(avg.toFixed(5)) }
    })
    .filter(Boolean) as { time: number; value: number }[]
}

function calculateZigZag(candles: Candle[], depth = 5): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = []
  let lastDir = 0
  for (let i = depth; i < candles.length - depth; i++) {
    const c = candles[i]
    const win = candles.slice(i - depth, i + depth + 1)
    const isHigh = c.high >= Math.max(...win.map(x => x.high))
    const isLow  = c.low  <= Math.min(...win.map(x => x.low))
    if (isHigh && lastDir !== 1)  { points.push({ time: c.time as number, value: c.high }); lastDir = 1 }
    else if (isLow && lastDir !== -1) { points.push({ time: c.time as number, value: c.low });  lastDir = -1 }
  }
  return points
}

function toHeikenAshi(candles: Candle[]): Candle[] {
  const ha: Candle[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const haClose = parseFloat(((c.open + c.high + c.low + c.close) / 4).toFixed(5))
    const haOpen  = i === 0 ? parseFloat(((c.open + c.close) / 2).toFixed(5)) : parseFloat(((ha[i-1].open + ha[i-1].close) / 2).toFixed(5))
    const haHigh  = Math.max(c.high, haOpen, haClose)
    const haLow   = Math.min(c.low,  haOpen, haClose)
    ha.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose })
  }
  return ha
}

export function TradingChart({ asset, marketPrice, onInfoClick, theme = 'noite', autoScroll = true, performanceMode = true, activeTrade, chartTradeEvent }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<any>(null)
  const autoScrollRef = useRef(autoScroll)
  const displayPriceRef = useRef(marketPrice ?? asset.price)
  const tradeIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([])

  const [timestamp, setTimestamp] = useState('')
  const [tfIndex, setTfIndex] = useState(3)
  const [tfOpen, setTfOpen] = useState(false)
  const [tradeLinePositions, setTradeLinePositions] = useState<{ entryX: number; expiryX: number; entryY: number } | null>(null)
  const [tradeResultPosition, setTradeResultPosition] = useState<number | null>(null)
  const [tradeCountdown, setTradeCountdown] = useState(0)
  const [candleSecsLeft, setCandleSecsLeft] = useState(0)
  const [candleTimerY, setCandleTimerY] = useState<number | null>(null)
  const [candleTimerX, setCandleTimerX] = useState<number | null>(null)
  const [candleTimerPulse, setCandleTimerPulse] = useState(false)
  const [drawingsOpen, setDrawingsOpen] = useState(false)
  const [indicadoresOpen, setIndicadoresOpen] = useState(false)
  const [chartType, setChartType] = useState<ChartType>('velas')
  const [chartTypeOpen, setChartTypeOpen] = useState(false)
  const [activeIndicators, setActiveIndicators] = useState<Set<string>>(new Set(['moving-average', 'zig-zag']))

  const showSMA     = activeIndicators.has('moving-average')
  const showZigzag  = activeIndicators.has('zig-zag')

  function toggleIndicator(id: string) {
    setActiveIndicators(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function clearAllIndicators() {
    setActiveIndicators(new Set())
  }

  const selectedTf = TIMEFRAMES[tfIndex]
  const selectedChartType = CHART_TYPES.find(t => t.key === chartType)!
  const displayPrice = marketPrice ?? asset.price

  useEffect(() => {
    displayPriceRef.current = displayPrice
  }, [displayPrice])

  useEffect(() => {
    const updateTimestamp = () => {
      // UTC-3 fixo (horário de Brasília), independente do timezone do sistema
      const nowUtc = Date.now()
      const brt = new Date(nowUtc - 3 * 3600 * 1000)
      const h = brt.getUTCHours().toString().padStart(2, '0')
      const m = brt.getUTCMinutes().toString().padStart(2, '0')
      const s = brt.getUTCSeconds().toString().padStart(2, '0')
      setTimestamp(`${h}:${m}:${s} UTC-3`)
    }
    updateTimestamp()
    const t = setInterval(updateTimestamp, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
    const c = THEME_COLORS[theme]
    chartRef.current.applyOptions({
      layout: { background: { color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border, textColor: c.text },
      timeScale: { borderColor: c.border },
      crosshair: {
        vertLine: { color: c.crosshair, labelBackgroundColor: c.labelBg },
        horzLine: { color: c.crosshair, labelBackgroundColor: c.labelBg },
      },
    })
  }, [theme])

  useEffect(() => {
    if (!chartRef.current) return
    chartRef.current.applyOptions({
      kineticScroll: { touch: !performanceMode, mouse: !performanceMode },
      handleScale: { axisPressedMouseMove: !performanceMode },
    })
  }, [performanceMode])

  useEffect(() => {
    autoScrollRef.current = autoScroll
    if (autoScroll && chartRef.current) {
      chartRef.current.timeScale().scrollToRealTime()
    }
  }, [autoScroll])

  // ── Active trade: price line + vertical lines + countdown ────────────────
  useEffect(() => {
    // Clear previous
    tradeIntervalsRef.current.forEach(clearInterval)
    tradeIntervalsRef.current = []
    setTradeLinePositions(null)
    setTradeCountdown(0)
    setTradeResultPosition(null)

    if (!activeTrade) return

    const updateTradeLinePositions = () => {
      if (!chartRef.current) return
      const ts = chartRef.current.timeScale()
      const rawEntryX = ts.timeToCoordinate(activeTrade.entryTime)
      const rawExpiryX = ts.timeToCoordinate(activeTrade.expiryTime)
      const fallbackWidth = chartContainerRef.current?.clientWidth ?? 0
      const fallbackEntryX = fallbackWidth > 0 ? fallbackWidth * 0.78 : 120
      const entryX = rawEntryX ?? fallbackEntryX
      const expiryX = rawExpiryX ?? entryX + 120
      const fallbackY = ((chartContainerRef.current?.clientHeight ?? 0) * 0.55) || 120
      const entryY = seriesRef.current?.priceToCoordinate(activeTrade.entryPrice) ?? fallbackY
      setTradeLinePositions({ entryX, expiryX, entryY })
    }

    updateTradeLinePositions()
    const posId = setInterval(updateTradeLinePositions, 200)
    tradeIntervalsRef.current.push(posId)

    // Countdown
    const tick = () => {
      const remaining = activeTrade.expiryTime - Math.floor(Date.now() / 1000)
      setTradeCountdown(Math.max(0, remaining))
    }
    tick()
    const countId = setInterval(tick, 1000)
    tradeIntervalsRef.current.push(countId)

    return () => {
      tradeIntervalsRef.current.forEach(clearInterval)
      tradeIntervalsRef.current = []
    }
  }, [activeTrade])

  useEffect(() => {
    if (!chartTradeEvent || !chartRef.current) return
    const ts = chartRef.current.timeScale()
    const resultX = ts.timeToCoordinate(chartTradeEvent.expiryTime)
    if (resultX != null) setTradeResultPosition(resultX)
  }, [chartTradeEvent])

  useEffect(() => {
    let chart: any = null
    let priceInterval: ReturnType<typeof setInterval>

    async function initChart() {
      if (!chartContainerRef.current) return

      const { createChart, ColorType, CrosshairMode, LineStyle, CandlestickSeries, LineSeries, AreaSeries, BarSeries } = await import('lightweight-charts')

      const tc = THEME_COLORS[theme]
      chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: tc.bg },
          textColor: tc.text,
          fontSize: 11,
        },
        grid: {
          vertLines: { color: tc.grid, style: 1 },
          horzLines: { color: tc.grid, style: 1 },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: tc.crosshair, labelBackgroundColor: tc.labelBg },
          horzLine: { color: tc.crosshair, labelBackgroundColor: tc.labelBg },
        },
        rightPriceScale: { borderColor: tc.border, textColor: tc.text },
        timeScale: {
          borderColor: tc.border,
          timeVisible: true,
          secondsVisible: selectedTf.seconds < 60,
          fixLeftEdge: false,
          rightOffset: 10,
          barSpacing: 8,
          lockVisibleTimeRangeOnResize: true,
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })

      chartRef.current = chart

      let candles = generateMockCandles(displayPrice, 150, selectedTf.seconds)
      if (asset.source === 'BINANCE' && asset.marketSymbol) {
        try {
          const remoteCandles = await fetchBinanceCandles(asset.marketSymbol, BINANCE_INTERVAL_BY_TIMEFRAME[selectedTf.seconds] ?? '1m', 150)
          candles = remoteCandles.map((candle) => ({
            ...candle,
            time: candle.time + BRT_OFFSET,
          }))
        } catch {
          candles = generateMockCandles(displayPrice, 150, selectedTf.seconds)
        }
      }

      // Main series based on chart type
      let mainSeries: any
      if (chartType === 'area') {
        mainSeries = chart.addSeries(AreaSeries, {
          lineColor: '#26a69a',
          topColor: 'rgba(38, 166, 154, 0.3)',
          bottomColor: 'rgba(38, 166, 154, 0.01)',
          lineWidth: 2,
        })
        mainSeries.setData(candles.map(c => ({ time: c.time, value: c.close })))
      } else if (chartType === 'barras') {
        mainSeries = chart.addSeries(BarSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
        })
        mainSeries.setData(candles)
      } else if (chartType === 'heiken-ashi') {
        mainSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderUpColor: '#26a69a',
          borderDownColor: '#ef5350',
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        })
        mainSeries.setData(toHeikenAshi(candles))
      } else {
        mainSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderUpColor: '#26a69a',
          borderDownColor: '#ef5350',
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        })
        mainSeries.setData(candles)
      }

      seriesRef.current = mainSeries

      // Dashed price line at current close — estilo Quotex
      mainSeries.applyOptions({
        priceLineVisible: true,
        priceLineStyle: LineStyle.Dashed,
        priceLineColor: 'rgba(255,255,255,0.25)',
        lastValueVisible: false,
      })

      // SMA overlay
      if (showSMA) {
        const smaData = calculateSMA(candles, 20)
        const smaSeries = chart.addSeries(LineSeries, {
          color: '#eab308',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        smaSeries.setData(smaData)
      }

      // ZigZag overlay
      if (showZigzag) {
        const zzData = calculateZigZag(candles, 5)
        if (zzData.length > 1) {
          const zzSeries = chart.addSeries(LineSeries, {
            color: '#ef4444',
            lineWidth: 1.5,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          })
          zzSeries.setData(zzData)
        }
      }

      chart.timeScale().fitContent()
      chart.timeScale().scrollToRealTime()

      const tfSec = selectedTf.seconds

      const nowSec = () => Math.floor(Date.now() / 1000) + BRT_OFFSET
      const alignedStart = (t: number) => Math.floor(t / tfSec) * tfSec

      let price = candles[candles.length - 1]?.close ?? displayPriceRef.current
      const latestCandleTime = candles[candles.length - 1]?.time
      let candleStart = latestCandleTime ?? alignedStart(nowSec())
      let candleOpen = price
      let candleHigh = price
      let candleLow = price
      let lastSecsLeft = -1

      priceInterval = setInterval(() => {
        const now = nowSec()
        const liveDisplayPrice = displayPriceRef.current
        const decimals = liveDisplayPrice > 10 ? 3 : 5
        const fmt5 = (v: number) => parseFloat(v.toFixed(decimals))
        const nextPrice = asset.source === 'BINANCE' ? liveDisplayPrice : price

        if (asset.source !== 'BINANCE') {
          const reversion = (liveDisplayPrice - price) * 0.0008
          const vol = liveDisplayPrice * 0.00012
          const noise = (Math.random() - 0.5) * vol * 2.2
          const tick = ((Math.random() - 0.5) * 0.5) * vol + reversion + noise
          price = fmt5(price + tick)
          if (price <= 0) price = fmt5(liveDisplayPrice * 0.95)
        } else {
          price = fmt5(nextPrice)
        }

        candleHigh = Math.max(candleHigh, price)
        candleLow = Math.min(candleLow, price)

        if (now >= candleStart + tfSec) {
          candleStart = Math.max(candleStart + tfSec, alignedStart(now))
          candleOpen = price
          candleHigh = price
          candleLow = price
        }

        const candle = { time: candleStart, open: candleOpen, high: candleHigh, low: candleLow, close: price }

        if (chartType === 'area') {
          mainSeries.update({ time: candleStart, value: price })
        } else if (chartType === 'heiken-ashi') {
          const haClose = fmt5((candleOpen + candleHigh + candleLow + price) / 4)
          mainSeries.update({ ...candle, close: haClose })
        } else {
          mainSeries.update(candle)
        }

        if (autoScrollRef.current && chartRef.current) {
          chartRef.current.timeScale().scrollToRealTime()
        }

        const secsLeft = tfSec - (now % tfSec)
        if (secsLeft !== lastSecsLeft) {
          lastSecsLeft = secsLeft
          setCandleSecsLeft(secsLeft)
          setCandleTimerPulse(secsLeft <= 5 ? secsLeft % 2 === 0 : false)
        }

        const y = mainSeries.priceToCoordinate(price)
        if (y != null) setCandleTimerY(y)
        if (chartRef.current) {
          const x = chartRef.current.timeScale().timeToCoordinate(candleStart + tfSec)
          if (x != null) setCandleTimerX(x)
        }
      }, 1000)
    }

    initChart()

    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    })

    if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current)

    return () => {
      clearInterval(priceInterval)
      resizeObserver.disconnect()
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [asset.id, asset.marketSymbol, asset.source, tfIndex, chartType, showSMA, showZigzag])

  const fmt = (v: number) => v.toFixed(displayPrice > 10 ? 3 : 5)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#151822] relative overflow-hidden" onClick={() => { setTfOpen(false); setChartTypeOpen(false) }} onKeyDown={() => {}}>

      {/* Top info bar */}
      <div className="absolute top-2 left-3 z-10 flex items-center gap-3 pointer-events-none">
        <div className="text-[11px] text-[#8b8f9a]">{timestamp}</div>
        <button
          onClick={onInfoClick}
          className="pointer-events-auto flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-blue-500/20 border border-blue-400 flex items-center justify-center text-[8px] font-bold">i</span>
          INFORMAÇÃO DO PAR
        </button>
      </div>

      {/* Active indicators bar */}
      {(showSMA || showZigzag) && (
        <div className="absolute top-8 left-3 z-10 flex items-center gap-2 pointer-events-none">
          <button className="pointer-events-auto w-5 h-5 flex items-center justify-center text-[#8b8f9a] hover:text-white transition-colors">
            <Eye size={12} />
          </button>

          {showSMA && (
            <div className="pointer-events-auto flex items-center gap-1 bg-[#1d2130]/80 border border-[#2a2e3b] rounded px-2 py-0.5 text-[10px]">
              <span className="font-bold text-[#8b8f9a] tracking-widest">MOVING AVERAGE</span>
              <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400 flex-shrink-0 ml-0.5" />
              <span className="text-[#8b8f9a] ml-0.5">SMA</span>
              <span className="text-white font-bold">20</span>
              <button className="text-[#8b8f9a] hover:text-white ml-1 transition-colors"><Pen size={9} /></button>
              <button onClick={() => toggleIndicator('moving-average')} className="text-[#8b8f9a] hover:text-red-400 ml-0.5 transition-colors"><X size={9} /></button>
            </div>
          )}

          {showZigzag && (
            <div className="pointer-events-auto flex items-center gap-1 bg-[#1d2130]/80 border border-[#2a2e3b] rounded px-2 py-0.5 text-[10px]">
              <span className="font-bold text-[#8b8f9a] tracking-widest">ZIG ZAG</span>
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0 ml-0.5" />
              <span className="text-white font-bold">5</span>
              <span className="text-white font-bold">12</span>
              <span className="text-white font-bold">3</span>
              <button className="text-[#8b8f9a] hover:text-white ml-1 transition-colors"><Pen size={9} /></button>
              <button onClick={() => toggleIndicator('zig-zag')} className="text-[#8b8f9a] hover:text-red-400 ml-0.5 transition-colors"><X size={9} /></button>
            </div>
          )}
        </div>
      )}

      {/* Abertura / Fechamento labels — só aparecem com operação ativa */}
      {activeTrade && tradeLinePositions && (
        <div className="absolute top-14 left-0 right-0 z-10 pointer-events-none">
          <span
            className="absolute text-[10px] text-[#8b8f9a] opacity-70 -translate-x-1/2"
            style={{ left: tradeLinePositions.entryX }}
          >
            Abertura da negociação
          </span>
          <span
            className="absolute text-[10px] text-[#8b8f9a] opacity-70 -translate-x-1/2"
            style={{ left: tradeLinePositions.expiryX }}
          >
            Fechamento da negociação
          </span>
        </div>
      )}

      {chartTradeEvent && tradeResultPosition != null && (
        <div
          className="absolute z-[6] pointer-events-none"
          style={{
            left: tradeResultPosition - 18,
            top: tradeLinePositions?.entryY != null ? tradeLinePositions.entryY - 20 : 118,
          }}
        >
          <div className={cn(
            'px-2 py-1 rounded-md text-[10px] font-bold text-white shadow-lg whitespace-nowrap',
            chartTradeEvent.status === 'RESOLVED'
              ? chartTradeEvent.won
                ? 'bg-green-500/90'
                : 'bg-red-500/90'
              : chartTradeEvent.direction === 'CALL'
                ? 'bg-[#26a69a]/90'
                : 'bg-[#ef5350]/90'
          )}>
            {chartTradeEvent.status === 'RESOLVED'
              ? chartTradeEvent.won ? 'EXECUTADA' : 'EXPIRADA'
              : chartTradeEvent.direction === 'CALL' ? 'COMPRA' : 'VENDA'}
          </div>
          <div className={cn(
            'absolute left-1/2 -translate-x-1/2 mt-1 w-2.5 h-2.5 rounded-full ring-2 ring-[#151822]',
            chartTradeEvent.status === 'RESOLVED'
              ? chartTradeEvent.won ? 'bg-green-400' : 'bg-red-400'
              : chartTradeEvent.direction === 'CALL' ? 'bg-[#26a69a]' : 'bg-[#ef5350]'
          )} />
        </div>
      )}

      {/* Drawings panel overlay */}
      {drawingsOpen && <DrawingsPanel onClose={() => setDrawingsOpen(false)} />}

      {/* Indicators panel overlay */}
      {indicadoresOpen && (
        <IndicadoresPanel
          onClose={() => setIndicadoresOpen(false)}
          activeIds={activeIndicators}
          onToggle={toggleIndicator}
          onClearAll={clearAllIndicators}
        />
      )}

      {/* Vertical trade lines */}
      {activeTrade && tradeLinePositions && (
        <>
          <div
            className="absolute pointer-events-none z-[5]"
            style={{
              left: tradeLinePositions.entryX,
              top: tradeLinePositions.entryY,
              width: Math.max(0, tradeLinePositions.expiryX - tradeLinePositions.entryX),
              borderTop: `2px solid ${activeTrade.direction === 'CALL' ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)'}`,
            }}
          />
          <div
            className="absolute pointer-events-none z-[4]"
            style={{
              left: tradeLinePositions.entryX,
              top: tradeLinePositions.entryY + 1,
              width: Math.max(0, tradeLinePositions.expiryX - tradeLinePositions.entryX),
              borderTop: '1px dashed rgba(255,255,255,0.18)',
            }}
          />
          <div
            className="absolute z-[6] pointer-events-none"
            style={{ left: tradeLinePositions.entryX - 4, top: tradeLinePositions.entryY - 4 }}
          >
            <div className={cn(
              'w-2.5 h-2.5 rounded-full ring-2 ring-[#151822]',
              activeTrade.direction === 'CALL' ? 'bg-[#26a69a]' : 'bg-[#ef5350]'
            )} />
          </div>
          <div
            className="absolute z-[6] pointer-events-none"
            style={{ left: tradeLinePositions.expiryX - 4, top: tradeLinePositions.entryY - 4 }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-white ring-2 ring-[#151822]" />
          </div>
          <div
            className="absolute z-[6] pointer-events-none"
            style={{ left: tradeLinePositions.entryX + 6, top: tradeLinePositions.entryY - 24 }}
          >
            <div className={cn(
              'px-2 py-1 rounded-md text-[10px] font-bold text-white shadow-lg whitespace-nowrap',
              activeTrade.direction === 'CALL' ? 'bg-[#26a69a]/90' : 'bg-[#ef5350]/90'
            )}>
              {activeTrade.direction === 'CALL' ? 'COMPRA' : 'VENDA'}
            </div>
          </div>
        </>
      )}

      {/* Chart */}
      <div ref={chartContainerRef} className="flex-1 w-full" />

      {/* Candle expiry timer — ao lado da vela atual, na linha tracejada */}
      {candleTimerY != null && candleTimerX != null && (
        <div
          className="absolute z-10 pointer-events-none"
          style={{ top: candleTimerY, left: candleTimerX + 10, transform: 'translateY(-50%)' }}
        >
          <div className={cn(
            'bg-[#1d2130] border border-[#2a2e3b] text-white text-[10px] font-mono font-bold px-1.5 py-[2px] rounded transition-opacity duration-150',
            candleTimerPulse ? 'opacity-55' : 'opacity-100'
          )}>
            {String(Math.floor(candleSecsLeft / 60)).padStart(2, '0')}:{String(candleSecsLeft % 60).padStart(2, '0')}
          </div>
        </div>
      )}

      {/* Bottom left toolbar — vertical column */}
      <div className="absolute bottom-3 left-3 flex flex-col items-start gap-1 z-10">
        {/* Pencil / Drawings */}
        <button
          onClick={() => setDrawingsOpen(v => !v)}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded border transition-colors',
            drawingsOpen ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1d2130] border-[#2a2e3b] text-[#8b8f9a] hover:text-white'
          )}
        >
          <Pencil size={12} />
        </button>

        {/* Timeframe selector */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setTfOpen(v => !v); setChartTypeOpen(false) }}
            className="w-7 h-7 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-white text-[10px] font-bold hover:border-blue-500/50 transition-colors"
          >
            {selectedTf.label}
          </button>
          {tfOpen && (
            <div
              className="absolute bottom-full mb-1 left-0 bg-[#1d2130] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-50"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-2 gap-px p-1 w-[100px]">
                {TIMEFRAMES.map((tf, i) => (
                  <button
                    key={tf.label}
                    onClick={() => { setTfIndex(i); setTfOpen(false) }}
                    className={cn('px-2 py-1.5 text-xs font-bold rounded transition-colors', i === tfIndex ? 'bg-blue-600 text-white' : 'text-[#8b8f9a] hover:text-white hover:bg-white/5')}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chart type selector */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setChartTypeOpen(v => !v); setTfOpen(false) }}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded border transition-colors',
              chartTypeOpen ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1d2130] border-[#2a2e3b] text-[#8b8f9a] hover:text-white'
            )}
          >
            {selectedChartType.icon}
          </button>
          {chartTypeOpen && (
            <div
              className="absolute bottom-full mb-1 left-0 bg-[#1d2130] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-50 w-[140px]"
              onClick={(e) => e.stopPropagation()}
            >
              {CHART_TYPES.map((ct) => (
                <button
                  key={ct.key}
                  onClick={() => { setChartType(ct.key); setChartTypeOpen(false) }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                    ct.key === chartType ? 'bg-blue-600/30 text-white' : 'text-[#8b8f9a] hover:bg-white/5 hover:text-white'
                  )}
                >
                  <span className={ct.key === chartType ? 'text-white' : 'text-[#8b8f9a]'}>{ct.icon}</span>
                  <span className="font-medium">{ct.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Indicators toggle */}
        <button
          onClick={() => { setIndicadoresOpen(v => !v); setDrawingsOpen(false) }}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded border transition-colors',
            indicadoresOpen ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1d2130] border-[#2a2e3b] text-[#8b8f9a] hover:text-white'
          )}
        >
          <Activity size={12} />
        </button>

        {/* Crosshair */}
        <button className="w-7 h-7 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white transition-colors">
          <Crosshair size={12} />
        </button>

        </div>

      {/* Bottom right zoom */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 z-10">
        <button
          onClick={() => chartRef.current?.timeScale().scrollToPosition((chartRef.current.timeScale().scrollPosition() ?? 0) - 5, true)}
          className="w-7 h-7 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white transition-colors"
        >
          <ZoomOut size={12} />
        </button>
        <button
          onClick={() => chartRef.current?.timeScale().scrollToPosition((chartRef.current.timeScale().scrollPosition() ?? 0) + 5, true)}
          className="w-7 h-7 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white transition-colors"
        >
          <ZoomIn size={12} />
        </button>
      </div>
    </div>
  )
}
