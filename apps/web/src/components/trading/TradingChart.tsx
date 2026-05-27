'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, ZoomIn, ZoomOut, Crosshair, ChevronDown, Eye, X, Activity } from 'lucide-react'
import { generateMockCandles, type Asset, type Candle, type ActiveTrade, type ChartTradeEvent } from '@/lib/mockData'
import { fetchBinanceCandles } from '@/lib/marketApi'
import { fetchOtcCandles, subscribeOtcCandles } from '@/lib/otcMarket'
import { fetchForexCandles, subscribeForexCandles } from '@/lib/forexMarket'
import { getCachedCandles, setCachedCandles } from '@/lib/candleCache'
import { subscribeKline } from '@/lib/binanceKline'
import { cn } from '@/lib/utils'
import { DrawingsPanel } from './DrawingsPanel'
import { IndicadoresPanel } from './IndicadoresPanel'
import {
  INDICATORS,
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
  calculateRSI,
} from '@/lib/indicators'
import {
  DRAWING_TOOLS,
  FIB_LEVELS,
  DRAWING_DEFAULT_COLOR,
  type Drawing,
  type DrawingToolId,
  type Point as DrawingPoint,
} from '@/lib/drawings'

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
  { label: '1m',  seconds: 60   },
  { label: '5m',  seconds: 300  },
  { label: '15m', seconds: 900  },
  { label: '1h',  seconds: 3600 },
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
  // True when marketPrice comes from the live Binance WebSocket; false when
  // it's the static asset.price fallback (WS hasn't connected yet for this
  // asset). The chart uses this to decide whether to sync the freshly-loaded
  // candle to the live price immediately (no visible "candle disappears and
  // reappears at another price" jump) or wait for the WS.
  hasFreshTicker?: boolean
  onInfoClick: () => void
  theme?: ChartTheme
  autoScroll?: boolean
  performanceMode?: boolean
  activeTrades?: ActiveTrade[]
  chartTradeEvents?: ChartTradeEvent[]
}

const BINANCE_INTERVAL_BY_TIMEFRAME: Record<number, string> = {
  60:   '1m',
  300:  '5m',
  900:  '15m',
  3600: '1h',
}

function nextDrawingId() {
  return `dr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
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

export function TradingChart({ asset, marketPrice, hasFreshTicker = false, onInfoClick, theme = 'noite', autoScroll = true, performanceMode = true, activeTrades = [], chartTradeEvents = [] }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<any>(null)
  const autoScrollRef = useRef(autoScroll)
  const displayPriceRef = useRef(marketPrice ?? asset.price)
  // Latest hasFreshTicker value, read by the chart effect when its async
  // fetch resumes (the effect's closure captured the value from when the
  // effect started, so without a ref it would always see the asset-switch-
  // moment value, never the "WS just arrived" updates).
  const hasFreshTickerRef = useRef(hasFreshTicker)
  // (OTC v2 candle WS replaces the old per-tick ref — server pushes the
  // full OHLC of the current bar so the chart no longer needs to track
  // a scalar live price for OTC; the candle subscription mutates the
  // series directly, mirroring the Binance kline path.)

  const [timestamp, setTimestamp] = useState('')
  const [tfIndex, setTfIndex] = useState(0)  // 1m default
  const [tfOpen, setTfOpen] = useState(false)
  const [chartReady, setChartReady] = useState(false)
  // Safety net for the loading overlay — if chartReady stays false for
  // longer than this (slow OTC backend, candle fetch timeout, network
  // hiccup), force the overlay off so the user isn't trapped staring
  // at a spinner forever. Resets whenever the asset changes.
  const [overlayTimedOut, setOverlayTimedOut] = useState(false)
  useEffect(() => {
    setOverlayTimedOut(false)
    const t = setTimeout(() => setOverlayTimedOut(true), 3000)
    return () => clearTimeout(t)
  }, [asset.id])
  const showLoadingOverlay = !chartReady && !overlayTimedOut
  const [candleSecsLeft, setCandleSecsLeft] = useState(0)
  const [candleTimerY, setCandleTimerY] = useState<number | null>(null)
  const [candleTimerX, setCandleTimerX] = useState<number | null>(null)
  const [candleTimerPulse, setCandleTimerPulse] = useState(false)
  const [drawingsOpen, setDrawingsOpen] = useState(false)
  const [indicadoresOpen, setIndicadoresOpen] = useState(false)
  const [chartType, setChartType] = useState<ChartType>('velas')
  const [chartTypeOpen, setChartTypeOpen] = useState(false)
  const [activeIndicators, setActiveIndicators] = useState<Set<string>>(new Set())

  // Stable string for use in effect dep arrays (Set identity changes every render).
  const activeIndicatorKey = Array.from(activeIndicators).sort().join(',')
  const activeIndicatorDefs = INDICATORS.filter((i) => activeIndicators.has(i.id))
  const rsiActive = activeIndicators.has('rsi-14')

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

  // ── Drawing tools ────────────────────────────────────────────────────────
  // Active drawings persist in state. Horizontal lines render via the
  // series' built-in createPriceLine; vertical / trend / fib render as SVG
  // overlays positioned with time/price → pixel mapping (re-positioned on
  // pan/zoom). Clicks on the chart consume the active tool.
  const [activeTool,   setActiveTool]   = useState<DrawingToolId | null>(null)
  const [drawings,     setDrawings]     = useState<Drawing[]>([])
  const [pendingPoint, setPendingPoint] = useState<DrawingPoint | null>(null)

  const activeToolRef   = useRef<DrawingToolId | null>(null)
  const pendingPointRef = useRef<DrawingPoint | null>(null)
  const priceLinesRef   = useRef<Map<string, any>>(new Map())

  useEffect(() => { activeToolRef.current   = activeTool   }, [activeTool])
  useEffect(() => { pendingPointRef.current = pendingPoint }, [pendingPoint])

  // Reset drawings whenever the asset changes — prices/scales differ.
  useEffect(() => {
    setDrawings([])
    setPendingPoint(null)
    setActiveTool(null)
  }, [asset.id])

  // When the chart instance is recreated, the priceLines we held are dead
  // (their parent series no longer exists). Drop the map so the next sync
  // effect re-creates them on the new series.
  useEffect(() => {
    if (!chartReady) priceLinesRef.current.clear()
  }, [chartReady])

  // ESC cancels the active drawing tool / pending point.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setActiveTool(null)
        setPendingPoint(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sync horizontal-line drawings with the series' built-in price lines.
  // (V-line / trend / fib render as overlays — handled separately.)
  useEffect(() => {
    if (!chartReady) return
    const series = seriesRef.current
    if (!series) return
    const lines = priceLinesRef.current
    const wantedIds = new Set<string>()

    for (const d of drawings) {
      if (d.type !== 'h-line') continue
      wantedIds.add(d.id)
      if (lines.has(d.id)) continue
      try {
        const ln = series.createPriceLine({
          price:            d.price,
          color:            DRAWING_DEFAULT_COLOR,
          lineWidth:        1,
          lineStyle:        0,  // Solid
          axisLabelVisible: true,
          title:            '',
        })
        lines.set(d.id, ln)
      } catch { /* series might be mid-recreate */ }
    }

    // Remove price lines whose drawings were deleted.
    for (const [id, ln] of Array.from(lines.entries())) {
      if (!wantedIds.has(id)) {
        try { series.removePriceLine(ln) } catch {}
        lines.delete(id)
      }
    }
  }, [drawings, chartReady])

  // Toggle / activate a drawing tool from the panel.
  function selectDrawingTool(id: DrawingToolId) {
    setActiveTool(prev => (prev === id ? null : id))
    setPendingPoint(null)
  }
  function clearAllDrawings() {
    setDrawings([])
    setPendingPoint(null)
    setActiveTool(null)
    // createPriceLine cleanup happens in the h-line sync effect.
  }

  const selectedTf = TIMEFRAMES[tfIndex]
  const selectedChartType = CHART_TYPES.find(t => t.key === chartType)!
  const displayPrice = marketPrice ?? asset.price

  useEffect(() => {
    displayPriceRef.current = displayPrice
  }, [displayPrice])

  useEffect(() => {
    hasFreshTickerRef.current = hasFreshTicker
  }, [hasFreshTicker])

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
      // Allow dragging both axes — price axis drag pauses autoScale so user
      // can pan vertically; double-click on axis restores autoScale.
      handleScale: {
        axisPressedMouseMove: { time: !performanceMode, price: true },
      },
    })
  }, [performanceMode])

  useEffect(() => {
    autoScrollRef.current = autoScroll
    if (autoScroll && chartRef.current) {
      chartRef.current.timeScale().scrollToRealTime()
    }
  }, [autoScroll])

  // Reset the chart view to its defaults: fit the visible time range to
  // recent candles, re-enable autoScale on the price axis (undoes manual
  // vertical pan), and snap back to the live edge.
  function resetChartView() {
    const chart = chartRef.current
    if (!chart) return
    chart.timeScale().fitContent()
    chart.timeScale().scrollToRealTime()
    chart.priceScale('right').applyOptions({ autoScale: true })
  }

  // Zoom horizontally by manipulating barSpacing. Larger spacing = bars are
  // wider apart = visually zoomed in (fewer candles visible). Bounded to
  // keep the chart readable; factor > 1 zooms in, factor < 1 zooms out.
  function zoomChart(factor: number) {
    const ts = chartRef.current?.timeScale()
    if (!ts) return
    const current = (ts.options() as any).barSpacing ?? 8
    const next    = Math.max(2, Math.min(50, current * factor))
    ts.applyOptions({ barSpacing: next })
  }

  useEffect(() => {
    let chart: any = null
    let disposed = false
    let priceInterval: ReturnType<typeof setInterval> | undefined
    let klineUnsub:       (() => void) | undefined
    let otcCandleUnsub:   (() => void) | undefined
    let forexCandleUnsub: (() => void) | undefined

    async function initChart() {
      if (!chartContainerRef.current || disposed) return

      const { createChart, ColorType, CrosshairMode, LineStyle, CandlestickSeries, LineSeries, AreaSeries, BarSeries } = await import('lightweight-charts')
      if (disposed || !chartContainerRef.current) return

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
        rightPriceScale: { borderColor: tc.border, textColor: tc.text, autoScale: true },
        timeScale: {
          borderColor: tc.border,
          timeVisible: true,
          secondsVisible: selectedTf.seconds < 60,
          fixLeftEdge: false,
          rightOffset: 10,
          barSpacing: 8,
          lockVisibleTimeRangeOnResize: true,
        },
        // Horizontal pan + zoom always, plus vertical pan (touch + price-axis
        // drag). Double-click the price axis to re-enable autoScale.
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,   // horizontal drag with mouse
          horzTouchDrag: true,
          vertTouchDrag: true,       // allow vertical touch pan
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: { time: true, price: true }, // drag price axis to pan vertically
          axisDoubleClickReset: true,
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })

      chartRef.current = chart

      let candles = generateMockCandles(displayPrice, 150, selectedTf.seconds)
      if (asset.source === 'BINANCE' && asset.marketSymbol) {
        const interval = BINANCE_INTERVAL_BY_TIMEFRAME[selectedTf.seconds] ?? '1m'
        // Cache lookup first — within the 60s TTL the previous fetch is
        // reused with zero wait, making switch-between-tabs feel instant.
        // The live interval picks up from the cached last close and
        // mutates from there; up to 1 candle of staleness is invisible
        // visually (the current 1m bar just extends a bit longer).
        const cached = getCachedCandles(asset.marketSymbol, interval)
        if (cached) {
          candles = cached
        } else {
          try {
            const remoteCandles = await fetchBinanceCandles(asset.marketSymbol, interval, 1000)
            if (disposed) return
            candles = remoteCandles.map((candle) => ({
              ...candle,
              time: candle.time + BRT_OFFSET,
            }))
            setCachedCandles(asset.marketSymbol, interval, candles)
          } catch {
            candles = generateMockCandles(displayPrice, 150, selectedTf.seconds)
          }
        }
      } else if (asset.source === 'FOREX') {
        // cTrader-backed forex: same response shape as OTC v2 so the
        // mapping below is identical, only the lib differs. Forex
        // candle times come in ms (epoch UTC); convert to BRT-shifted
        // seconds same as Binance/OTC.
        try {
          const remoteCandles = await fetchForexCandles(asset.id, selectedTf.seconds, 1000)
          if (disposed) return
          if (remoteCandles.length > 0) {
            candles = remoteCandles.map((c) => ({
              ...c,
              time: Math.floor(c.time / 1000) + BRT_OFFSET,
            }))
          }
        } catch {
          /* keep mock candles */
        }
      } else if (asset.source !== 'BINANCE') {
        // OTC v2 engine: server owns the candle history. Fetch the last
        // 1000 bars from the in-memory ring buffer (no DB hit on the API
        // side either). Keeps the initial payload small (~80KB) so the
        // chart paints fast even on mobile data. Server keeps 3000 in
        // cache for ops resolution and future scrollback expansion.
        try {
          const remoteCandles = await fetchOtcCandles(asset.id, selectedTf.seconds, 1000)
          if (disposed) return
          if (remoteCandles.length > 0) {
            candles = remoteCandles.map((c) => ({ ...c, time: c.time + BRT_OFFSET }))
          }
        } catch {
          /* keep mock candles */
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
      setChartReady(true)

      // Dashed price line at current close + live price label on the right
      // axis (Quotex-style). Background color follows the last bar (green up
      // / red down); built-in arrow pointer aligns the label with the line.
      mainSeries.applyOptions({
        priceLineVisible:  true,
        priceLineStyle:    LineStyle.Dashed,
        priceLineColor:    'rgba(255,255,255,0.25)',
        lastValueVisible:  true,
      })

      // ── Indicators ─────────────────────────────────────────────────────────
      // RSI lives on its own price scale at the bottom 25% of the chart.
      // When RSI is active the main price series is compressed to top 75%.
      if (rsiActive) {
        chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.28 } })
      }
      for (const def of activeIndicatorDefs) {
        if (def.type === 'sma') {
          const data = calculateSMA(candles, def.period)
          chart.addSeries(LineSeries, {
            color: def.color, lineWidth: 2,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          }).setData(data)
        } else if (def.type === 'ema') {
          const data = calculateEMA(candles, def.period)
          chart.addSeries(LineSeries, {
            color: def.color, lineWidth: 2,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          }).setData(data)
        } else if (def.type === 'bb') {
          const bb = calculateBollingerBands(candles, def.period, def.stdDev ?? 2)
          const baseOpts = { lineWidth: 1 as 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
          chart.addSeries(LineSeries, { ...baseOpts, color: def.color }).setData(bb.upper)
          chart.addSeries(LineSeries, { ...baseOpts, color: def.color + 'aa', lineStyle: LineStyle.Dashed }).setData(bb.middle)
          chart.addSeries(LineSeries, { ...baseOpts, color: def.color }).setData(bb.lower)
        } else if (def.type === 'rsi') {
          const data = calculateRSI(candles, def.period)
          const rsiSeries = chart.addSeries(LineSeries, {
            color: def.color, lineWidth: 2,
            priceScaleId: 'rsi',
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          })
          rsiSeries.setData(data)
          chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.78, bottom: 0 },
            borderColor:  tc.border,
          })
          // 70 / 30 dashed reference lines for overbought/oversold.
          rsiSeries.createPriceLine({ price: 70, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
          rsiSeries.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
        }
      }

      // Default zoom: show the last ~30 candles (≈ what's visually
      // comfortable on screen) instead of fitting all 1000 fetched bars.
      // The candle count is fixed in logical-units, so the visible window
      // scales the same regardless of timeframe (30 of 1m = 30min,
      // 30 of 1h = ~1.25 days). +5 to `to` gives breathing room on the
      // right so the live candle isn't glued to the price axis.
      const VISIBLE_BARS_DEFAULT = 30
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - VISIBLE_BARS_DEFAULT),
        to:   candles.length + 5,
      })
      chart.timeScale().scrollToRealTime()

      // ── Drawing click handler ───────────────────────────────────────────
      // Reads activeTool / pendingPoint via refs so it always sees the
      // latest state without re-subscribing on every render.
      chart.subscribeClick((param: any) => {
        const tool = activeToolRef.current
        if (!tool || !param.point) return
        const seriesNow = seriesRef.current
        if (!seriesNow) return
        const priceAtClick = seriesNow.coordinateToPrice(param.point.y)
        const timeAtClick  = (param.time as number | undefined) ?? chart.timeScale().coordinateToTime(param.point.x)
        if (priceAtClick == null || timeAtClick == null) return
        const point: DrawingPoint = { time: Number(timeAtClick), price: Number(priceAtClick) }

        if (tool === 'h-line') {
          setDrawings(d => [...d, { id: nextDrawingId(), type: 'h-line', price: point.price }])
          setActiveTool(null)
        } else if (tool === 'v-line') {
          setDrawings(d => [...d, { id: nextDrawingId(), type: 'v-line', time: point.time }])
          setActiveTool(null)
        } else {
          // trend / fib — needs 2 clicks
          const pending = pendingPointRef.current
          if (!pending) {
            setPendingPoint(point)
          } else {
            const t = tool
            setDrawings(d => [...d, { id: nextDrawingId(), type: t, p1: pending, p2: point }])
            setPendingPoint(null)
            setActiveTool(null)
          }
        }
      })

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
      // Tracks the previous tick's price — used by the gap-fill loop to keep
      // emitted "flat" candles at the SAME price level as the last visible
      // close (continuous line), not at whatever the live price happens to
      // be (which would create a visible wick at the gap boundary).
      let lastTickPrice = price

      // ── Initial price sync ────────────────────────────────────────────────
      // The bug: after setData paints the chart at fetched close, the first
      // interval tick (+1s later) may push the candle to a different price,
      // making it look like the current candle "disappeared and appeared at
      // another price". Two flavours:
      //   (a) Stale cached candles + fresh WS price → real delta, but jumps
      //       1s after the chart appears.
      //   (b) Fresh fetch + stale displayPriceRef (from previous asset or
      //       static fallback) → wrong price gets painted, then corrected.
      //
      // Fix: at load time, decide what to trust.
      //   • hasFreshTicker=true AND value is plausibly within range of the
      //     fetched close (0.5..2): WS data is fresh, sync the current
      //     candle to it IMMEDIATELY. User sees ONE price (the right one)
      //     instead of a jump.
      //   • Otherwise: anchor displayPriceRef to the fetched close. The
      //     first interval tick won't see a different value, so no jump.
      //     When the real WS arrives, the next tick picks it up naturally.
      if (latestCandleTime != null) {
        const liveDisplay = displayPriceRef.current
        const ratio = liveDisplay > 0 ? liveDisplay / price : 0
        const liveLooksReal = hasFreshTickerRef.current && ratio > 0.5 && ratio < 2

        if (liveLooksReal) {
          // Sync current candle to live WS price. Tiny visible move (sub-1%
          // typically) — much less jarring than the 1s-later jump.
          const last = candles[candles.length - 1]
          if (chartType === 'area') {
            mainSeries.update({ time: last.time, value: liveDisplay })
          } else if (chartType === 'heiken-ashi') {
            // Heiken-Ashi recomputes close as (o+h+l+c)/4 — let it derive.
            const haClose = parseFloat(((last.open + Math.max(last.high, liveDisplay) + Math.min(last.low, liveDisplay) + liveDisplay) / 4).toFixed(5))
            mainSeries.update({
              time: last.time, open: last.open,
              high: Math.max(last.high, liveDisplay),
              low:  Math.min(last.low,  liveDisplay),
              close: haClose,
            })
          } else {
            mainSeries.update({
              time: last.time, open: last.open,
              high: Math.max(last.high, liveDisplay),
              low:  Math.min(last.low,  liveDisplay),
              close: liveDisplay,
            })
          }
          price        = liveDisplay
          candleHigh   = Math.max(candleHigh, liveDisplay)
          candleLow    = Math.min(candleLow,  liveDisplay)
          lastTickPrice = liveDisplay
        } else {
          // Anchor — first interval tick will see this value, no jump.
          displayPriceRef.current = price
        }
      }

      priceInterval = setInterval(() => {
        if (disposed || !chartRef.current) return
        const now = nowSec()

        // ── PRICE / CANDLE UPDATE ─────────────────────────────────────────
        // For BINANCE assets, the kline WebSocket (subscribed below) pushes
        // the FULL official OHLC of the current candle on every trade —
        // there's nothing for the interval to synthesise. It just bookkeeps
        // the countdown timer + overlay coordinates further down.
        //
        // OTC v2 mirrors the Binance path: the server's candle stream
        // (subscribed below) pushes full OHLC updates. Nothing for the
        // interval to do for OTC either.

        // ── COMMON: auto-scroll, countdown timer, overlay coords ─────────
        if (autoScrollRef.current && chartRef.current) {
          chartRef.current.timeScale().scrollToRealTime()
        }

        const secsLeft = tfSec - (now % tfSec)
        if (secsLeft !== lastSecsLeft) {
          lastSecsLeft = secsLeft
          setCandleSecsLeft(secsLeft)
          setCandleTimerPulse(secsLeft <= 5 ? secsLeft % 2 === 0 : false)
        }

        // Timer position: compute from wall-clock + last known price, NOT
        // from `candleStart` (which only advances on SSE/WS events). With
        // the old code, if SSE was delayed/stalled or `price` hadn't been
        // hydrated yet, x/y came back null and the chip vanished. Now the
        // timer tracks the current slot regardless of feed health.
        const slotEnd = (Math.floor(now / tfSec) + 1) * tfSec
        const yPrice  = price || candles[candles.length - 1]?.close
        if (yPrice) {
          const y = mainSeries.priceToCoordinate(yPrice)
          if (y != null) setCandleTimerY(y)
        }
        const x = chartRef.current.timeScale().timeToCoordinate(slotEnd)
        if (x != null) setCandleTimerX(x)
      }, 1000)

      // ── Binance kline WebSocket — real OHLC, no synthesis ──────────────
      // Each kline event delivers the FULL current candle with live OHLC
      // straight from Binance. mainSeries.update() handles both cases:
      //   • same time as the latest bar → mutate it in place
      //   • greater time (minute rollover) → append a new bar
      // No gap-fill, no price guard, no displayPriceRef sync needed for
      // BINANCE — this is the live source. Closure-scoped `price`,
      // `candleStart`, etc. are kept in sync so the interval's timer
      // overlay still positions correctly.
      if (asset.source === 'BINANCE' && asset.marketSymbol) {
        const interval = BINANCE_INTERVAL_BY_TIMEFRAME[selectedTf.seconds] ?? '1m'
        klineUnsub = subscribeKline(asset.marketSymbol, interval, (k) => {
          if (disposed) return
          const time = k.time + BRT_OFFSET
          price        = k.close
          candleStart  = time
          candleOpen   = k.open
          candleHigh   = k.high
          candleLow    = k.low
          lastTickPrice = k.close

          if (chartType === 'area') {
            mainSeries.update({ time, value: k.close })
          } else if (chartType === 'heiken-ashi') {
            // Live Heiken-Ashi: simplified — full re-derivation would need
            // every prior bar's haOpen/haClose. The current bar's
            // approximation is acceptable visually.
            const haClose = parseFloat(((k.open + k.high + k.low + k.close) / 4).toFixed(5))
            mainSeries.update({ time, open: k.open, high: k.high, low: k.low, close: haClose })
          } else {
            mainSeries.update({ time, open: k.open, high: k.high, low: k.low, close: k.close })
          }
        })
      }

      // ── Forex candle stream — cTrader via /forex/v1/stream ─────────────
      // Same handler shape as the OTC branch below — only the subscribe
      // function and event shape (already normalised in forexMarket.ts)
      // differ. Forex updates land every 1.5s (poll cadence) rather than
      // tick-rate; the chart treats them identically.
      if (asset.source === 'FOREX') {
        forexCandleUnsub = subscribeForexCandles(asset.id, selectedTf.seconds, (c) => {
          if (disposed) return
          const time = Math.floor(c.openTime / 1000) + BRT_OFFSET
          price        = c.close
          candleStart  = time
          candleOpen   = c.open
          candleHigh   = c.high
          candleLow    = c.low
          lastTickPrice = c.close

          if (chartType === 'area') {
            mainSeries.update({ time, value: c.close })
          } else if (chartType === 'heiken-ashi') {
            const haClose = parseFloat(((c.open + c.high + c.low + c.close) / 4).toFixed(5))
            mainSeries.update({ time, open: c.open, high: c.high, low: c.low, close: haClose })
          } else {
            mainSeries.update({ time, open: c.open, high: c.high, low: c.low, close: c.close })
          }
        })
      }

      // ── OTC v2 candle stream — real server OHLC, no synthesis ──────────
      // For the OTC assets, the API engine pushes the full current bar
      // plus every rollover via SSE. Same shape as the Binance kline
      // handler, just different source.
      if (asset.source !== 'BINANCE' && asset.source !== 'FOREX') {
        otcCandleUnsub = subscribeOtcCandles(asset.id, selectedTf.seconds, (c) => {
          if (disposed) return
          const time = Math.floor(c.openTime / 1000) + BRT_OFFSET
          price        = c.close
          candleStart  = time
          candleOpen   = c.open
          candleHigh   = c.high
          candleLow    = c.low
          lastTickPrice = c.close

          if (chartType === 'area') {
            mainSeries.update({ time, value: c.close })
          } else if (chartType === 'heiken-ashi') {
            const haClose = parseFloat(((c.open + c.high + c.low + c.close) / 4).toFixed(5))
            mainSeries.update({ time, open: c.open, high: c.high, low: c.low, close: haClose })
          } else {
            mainSeries.update({ time, open: c.open, high: c.high, low: c.low, close: c.close })
          }
        })
      }
    }

    initChart()

    const resizeObserver = new ResizeObserver(() => {
      if (disposed || !chartRef.current || !chartContainerRef.current) return
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })
    })

    if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current)

    return () => {
      disposed = true
      if (priceInterval) clearInterval(priceInterval)
      if (klineUnsub)       klineUnsub()
      if (otcCandleUnsub)   otcCandleUnsub()
      if (forexCandleUnsub) forexCandleUnsub()
      resizeObserver.disconnect()
      seriesRef.current = null
      setChartReady(false)
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [asset.id, asset.marketSymbol, asset.source, tfIndex, chartType, activeIndicatorKey])

  const fmt = (v: number) => v.toFixed(displayPrice > 10 ? 3 : 5)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#151822] relative overflow-hidden" onClick={() => { setTfOpen(false); setChartTypeOpen(false); setDrawingsOpen(false); setIndicadoresOpen(false) }} onKeyDown={() => {}}>

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

      {/* Active indicators chip bar — one chip per active indicator */}
      {activeIndicatorDefs.length > 0 && (
        <div className="absolute top-8 left-3 z-10 flex items-center gap-2 pointer-events-none flex-wrap max-w-[calc(100%-24px)]">
          <button className="pointer-events-auto w-5 h-5 flex items-center justify-center text-[#8b8f9a] hover:text-white transition-colors">
            <Eye size={12} />
          </button>

          {activeIndicatorDefs.map((def) => (
            <div
              key={def.id}
              className="pointer-events-auto flex items-center gap-1.5 bg-[#1d2130]/80 border border-[#2a2e3b] rounded px-2 py-0.5 text-[10px]"
            >
              <span
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: def.color }}
              />
              <span className="text-white font-bold tracking-wide">{def.label}</span>
              <button
                onClick={() => toggleIndicator(def.id)}
                className="text-[#8b8f9a] hover:text-red-400 ml-0.5 transition-colors"
                title={`Remover ${def.label}`}
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drawing overlays (vertical line, trend line, fibonacci) — anchored
          to chart coords via timeToCoordinate / priceToCoordinate. */}
      {chartReady && drawings
        .filter((d): d is Exclude<Drawing, { type: 'h-line' }> => d.type !== 'h-line')
        .map((d) => (
          <DrawingOverlay
            key={d.id}
            drawing={d}
            chartRef={chartRef}
            seriesRef={seriesRef}
            containerRef={chartContainerRef}
          />
        ))}

      {/* Pending-first-click marker for trend / fib (visual confirmation of step 1/2). */}
      {chartReady && pendingPoint && (
        <PendingPointMarker
          point={pendingPoint}
          chartRef={chartRef}
          seriesRef={seriesRef}
        />
      )}

      {/* Drawing tool status chip (top-right) */}
      {activeTool && (
        <div className="absolute top-2 right-3 z-20 bg-blue-600/90 border border-blue-400 rounded px-2 py-1 text-[10px] text-white font-bold pointer-events-none shadow-lg">
          {DRAWING_TOOLS.find(t => t.id === activeTool)?.label}
          {pendingPoint ? ' — clique no 2º ponto' : ''}
          {' '}<span className="opacity-70">(ESC p/ cancelar)</span>
        </div>
      )}


      {/* One marker per active trade — each marker has its own state.
          stackIdx offsets the chip vertically when 2+ trades share the same candle. */}
      {chartReady && activeTrades.map((trade) => {
        const tfSec = selectedTf.seconds
        const myAligned = Math.floor(trade.entryTime / tfSec) * tfSec
        const sameCandle = activeTrades.filter(t => Math.floor(t.entryTime / tfSec) * tfSec === myAligned)
        const stackIdx = sameCandle.findIndex(t => t.id === trade.id)
        return (
          <TradeMarker
            key={trade.id}
            trade={trade}
            chartRef={chartRef}
            seriesRef={seriesRef}
            containerRef={chartContainerRef}
            tfSec={tfSec}
            stackIdx={stackIdx}
          />
        )
      })}

      {/* One result chip per resolved event (auto-cleared by parent after 4s) */}
      {chartReady && chartTradeEvents.map(event => (
        <TradeResultMarker
          key={event.id}
          event={event}
          chartRef={chartRef}
          seriesRef={seriesRef}
          tfSec={selectedTf.seconds}
        />
      ))}

      {/* Asset transition overlay — shown while !chartReady (initial mount
          or asset switch). chartReady flips false on cleanup of the chart-
          init effect and back to true once the series is created, so this
          covers the brief blank period during which the previous chart is
          torn down + the new asset's candles are fetched. Pulsing icon +
          asset name + "Carregando..." gives the user feedback that the
          transition is happening (was just a flash of empty bg before).
          z-20 sits above the chart but below the absolute dropdowns.
          Uses /vx-icon.png (project favicon, copied to public/) — the
          icon-only mark, NOT the full wordmark from vx-logo.png. */}
      {showLoadingOverlay && (
        <div className="absolute inset-0 z-20 bg-[#151822] flex flex-col items-center justify-center pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/vx-icon.png"
            alt="VX"
            width={96}
            height={96}
            className="h-24 w-24 opacity-90 animate-pulse object-contain"
            style={{ animationDuration: '1.4s' }}
            draggable={false}
          />
          {/* Negative margin pulls the text up to compensate for the
              transparent padding inside the icon PNG — sits visually
              flush with the icon's bottom edge. */}
          <div className="flex items-center gap-1.5 text-xs text-[#8b8f9a] -mt-4">
            <span>Carregando</span>
            <span className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-[#8b8f9a] animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-[#8b8f9a] animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-[#8b8f9a] animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </div>
        </div>
      )}

      {/* Chart */}
      <div ref={chartContainerRef} className="flex-1 w-full" />

      {/* Candle expiry timer — anchored to the RIGHT edge of the chart at
          the current price line's height. Anchoring by X (`candleTimerX +
          8`) put the chip past the chart's right edge when the slot end
          fell into the rightOffset zone — `overflow-hidden` then clipped
          it. Right-anchoring keeps the chip flush regardless of zoom/pan,
          and only the Y (price level) follows the live tick. Offset of
          70px clears the price-axis label column (~60px) without sitting
          on top of the price labels. Same pattern Quotex uses.
          Hidden while showLoadingOverlay is up (asset switch) — otherwise
          the chip from the OLD chart lingers on top of the "Carregando…"
          overlay until the new chart's first tick arrives. */}
      {candleTimerY != null && !showLoadingOverlay && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{ top: candleTimerY, right: 70, transform: 'translateY(-50%)' }}
        >
          <div className={cn(
            'bg-[#1d2130]/95 backdrop-blur-sm border border-[#3a3f50] text-white text-[11px] font-mono font-bold px-2 py-0.5 rounded shadow-lg shadow-black/40 transition-opacity duration-150',
            // User asked the candle clock to always stay white — kept the
            // subtle opacity pulse on the last 5s so the urgency cue still
            // exists, but dropped the red border + red text recolour that
            // used to fire below 5s.
            candleTimerPulse ? 'opacity-60' : 'opacity-100'
          )}>
            {String(Math.floor(candleSecsLeft / 60)).padStart(2, '0')}:{String(candleSecsLeft % 60).padStart(2, '0')}
          </div>
        </div>
      )}

      {/* Bottom left toolbar — vertical column, raised above the chart attribution */}
      <div className="absolute bottom-24 left-3 flex flex-col items-start gap-1.5 z-10">
        {/* Pencil / Drawings */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setDrawingsOpen(v => !v); setIndicadoresOpen(false); setTfOpen(false); setChartTypeOpen(false) }}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded border transition-colors',
              drawingsOpen ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1d2130] border-[#2a2e3b] text-[#8b8f9a] hover:text-white'
            )}
          >
            <Pencil size={16} />
          </button>
          {drawingsOpen && (
            <DrawingsPanel
              onSelectTool={(id) => { selectDrawingTool(id); setDrawingsOpen(false) }}
              onClearAll={() => { clearAllDrawings(); setDrawingsOpen(false) }}
              activeTool={activeTool}
              hasDrawings={drawings.length > 0}
            />
          )}
        </div>

        {/* Timeframe selector */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setTfOpen(v => !v); setChartTypeOpen(false) }}
            className="w-9 h-9 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-white text-xs font-bold hover:border-blue-500/50 transition-colors"
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
              'w-9 h-9 flex items-center justify-center rounded border transition-colors',
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
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setIndicadoresOpen(v => !v); setDrawingsOpen(false); setTfOpen(false); setChartTypeOpen(false) }}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded border transition-colors',
              indicadoresOpen ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1d2130] border-[#2a2e3b] text-[#8b8f9a] hover:text-white'
            )}
          >
            <Activity size={16} />
          </button>
          {indicadoresOpen && (
            <IndicadoresPanel
              activeIds={activeIndicators}
              onToggle={toggleIndicator}
              onClearAll={() => { clearAllIndicators(); setIndicadoresOpen(false) }}
            />
          )}
        </div>

        </div>

      {/* Bottom-center chart controls: zoom in / zoom out / reset view.
          Mirrors the Quotex layout — three small pill buttons centered
          above the date label & TradingView attribution. Offset bottom
          enough to clear the time-axis labels (~28px tall). */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
        <button
          onClick={() => zoomChart(1.25)}
          title="Aproximar"
          className="w-8 h-8 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white hover:border-blue-500/50 transition-colors active:scale-95"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => zoomChart(0.8)}
          title="Afastar"
          className="w-8 h-8 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white hover:border-blue-500/50 transition-colors active:scale-95"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={resetChartView}
          title="Centralizar gráfico (zoom padrão)"
          className="w-8 h-8 flex items-center justify-center rounded bg-[#1d2130] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white hover:border-blue-500/50 transition-colors active:scale-95"
        >
          <Crosshair size={14} />
        </button>
      </div>
    </div>
  )
}

// ── TradeMarker ─────────────────────────────────────────────────────────────
// Renders the entry chip + dotted line + entry/expiry dots for ONE open trade.
// Each instance owns its own position state and countdown so multiple markers
// can coexist without overwriting each other.
interface TradeMarkerProps {
  trade:         ActiveTrade
  chartRef:      React.MutableRefObject<any>
  seriesRef:     React.MutableRefObject<any>
  containerRef:  React.RefObject<HTMLDivElement | null>
  tfSec:         number
  stackIdx:      number
}

function TradeMarker({ trade, chartRef, seriesRef, containerRef, tfSec, stackIdx }: TradeMarkerProps) {
  const [pos, setPos]             = useState<{ entryX: number; expiryX: number; entryY: number } | null>(null)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    const update = () => {
      const chart = chartRef.current
      const series = seriesRef.current
      if (!chart || !series) return
      const ts = chart.timeScale()

      const entryAligned  = Math.floor(trade.entryTime  / tfSec) * tfSec
      const expiryAligned = Math.floor(trade.expiryTime / tfSec) * tfSec

      let entryX  = ts.timeToCoordinate(entryAligned)  ?? null
      let expiryX = ts.timeToCoordinate(expiryAligned) ?? null

      // Extrapolate when expiry is beyond the chart's rightOffset window.
      if (entryX != null && expiryX == null) {
        const range = ts.getVisibleLogicalRange?.()
        const w = containerRef.current?.clientWidth ?? 0
        if (range && w > 0) {
          const bars = Math.max(1, range.to - range.from)
          const barW = w / bars
          expiryX = entryX + ((expiryAligned - entryAligned) / tfSec) * barW
        }
      }
      if (expiryX != null && entryX == null) {
        const range = ts.getVisibleLogicalRange?.()
        const w = containerRef.current?.clientWidth ?? 0
        if (range && w > 0) {
          const bars = Math.max(1, range.to - range.from)
          const barW = w / bars
          entryX = expiryX - ((expiryAligned - entryAligned) / tfSec) * barW
        }
      }

      const entryY = series.priceToCoordinate(trade.entryPrice)
      if (entryX == null || expiryX == null || entryY == null) return
      setPos({ entryX, expiryX, entryY })
    }

    update()

    // Subscribe to pan/zoom for instant updates; poll every 500ms as a fallback
    // for late chart init and price-axis auto-scale (Y reposition).
    let subscribedTs: any = null
    const trySubscribe = () => {
      if (subscribedTs || !chartRef.current) return
      subscribedTs = chartRef.current.timeScale()
      subscribedTs.subscribeVisibleLogicalRangeChange(update)
    }
    trySubscribe()
    const tickPos = setInterval(() => { trySubscribe(); update() }, 500)

    const tickCountdown = () => {
      const nowBrt = Math.floor(Date.now() / 1000) + BRT_OFFSET
      setCountdown(Math.max(0, trade.expiryTime - nowBrt))
    }
    tickCountdown()
    const countId = setInterval(tickCountdown, 1000)

    return () => {
      clearInterval(tickPos)
      clearInterval(countId)
      if (subscribedTs) {
        try { subscribedTs.unsubscribeVisibleLogicalRangeChange(update) } catch {}
      }
    }
  }, [trade, tfSec, chartRef, seriesRef, containerRef])

  if (!pos) return null

  return (
    <>
      <div
        className="absolute pointer-events-none z-[5]"
        style={{
          left:       pos.entryX,
          top:        pos.entryY,
          width:      Math.max(0, pos.expiryX - pos.entryX),
          borderTop:  `2px solid ${trade.direction === 'CALL' ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)'}`,
        }}
      />
      <div
        className="absolute pointer-events-none z-[4]"
        style={{
          left:       pos.entryX,
          top:        pos.entryY + 1,
          width:      Math.max(0, pos.expiryX - pos.entryX),
          borderTop:  '1px dashed rgba(255,255,255,0.18)',
        }}
      />
      <div
        className="absolute z-[6] pointer-events-none"
        style={{ left: pos.entryX - 4, top: pos.entryY - 4 }}
      >
        <div className={cn(
          'w-2.5 h-2.5 rounded-full ring-2 ring-[#151822]',
          trade.direction === 'CALL' ? 'bg-[#26a69a]' : 'bg-[#ef5350]'
        )} />
      </div>
      <div
        className="absolute z-[6] pointer-events-none"
        style={{ left: pos.expiryX - 4, top: pos.entryY - 4 }}
      >
        <div className="w-2.5 h-2.5 rounded-full bg-white ring-2 ring-[#151822]" />
      </div>
      <div
        className="absolute z-[6] pointer-events-none"
        style={{
          // Stack chips for trades opened in the same candle so neither hides behind the other.
          left:      pos.entryX - 4,
          top:       pos.entryY - stackIdx * 24,
          transform: 'translate(-100%, -50%)',
        }}
      >
        <div className={cn(
          'flex items-center gap-1.5 pl-1 pr-2 py-[3px] rounded-full text-[10px] font-bold text-white shadow-lg whitespace-nowrap',
          trade.direction === 'CALL' ? 'bg-[#26a69a]' : 'bg-[#ef5350]'
        )}>
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-[9px] leading-none">
            {trade.direction === 'CALL' ? '▲' : '▼'}
          </span>
          <span>R$ {trade.amount}</span>
          <span className="font-mono opacity-90">
            {String(Math.floor(countdown / 60)).padStart(2, '0')}:{String(countdown % 60).padStart(2, '0')}
          </span>
        </div>
      </div>
    </>
  )
}

// ── TradeResultMarker ───────────────────────────────────────────────────────
// Brief EXECUTADA/EXPIRADA chip shown at the expiry of a just-resolved trade.
interface TradeResultMarkerProps {
  event:     ChartTradeEvent
  chartRef:  React.MutableRefObject<any>
  seriesRef: React.MutableRefObject<any>
  tfSec:     number
}

function TradeResultMarker({ event, chartRef, seriesRef, tfSec }: TradeResultMarkerProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const update = () => {
      const chart = chartRef.current
      const series = seriesRef.current
      if (!chart || !series) return
      const ts = chart.timeScale()
      // Snap expiry to candle boundary — same trick as TradeMarker.
      const expiryAligned = Math.floor(event.expiryTime / tfSec) * tfSec
      let x = ts.timeToCoordinate(expiryAligned)
      // Fall back: extrapolate from entry candle when expiry is beyond rightOffset.
      if (x == null) {
        const entryAligned = Math.floor(event.entryTime / tfSec) * tfSec
        const entryX = ts.timeToCoordinate(entryAligned)
        const range  = ts.getVisibleLogicalRange?.()
        const w      = chart.timeScale().width?.() ?? chart.chartElement?.()?.clientWidth ?? 0
        if (entryX != null && range && w > 0) {
          const bars = Math.max(1, range.to - range.from)
          const barW = w / bars
          x = entryX + ((expiryAligned - entryAligned) / tfSec) * barW
        }
      }
      const y = series.priceToCoordinate(event.entryPrice)
      if (x != null && y != null) setPos({ x, y })
    }
    update()
    let subscribedTs: any = null
    const trySubscribe = () => {
      if (subscribedTs || !chartRef.current) return
      subscribedTs = chartRef.current.timeScale()
      subscribedTs.subscribeVisibleLogicalRangeChange(update)
    }
    trySubscribe()
    const tickId = setInterval(() => { trySubscribe(); update() }, 500)
    return () => {
      clearInterval(tickId)
      if (subscribedTs) {
        try { subscribedTs.unsubscribeVisibleLogicalRangeChange(update) } catch {}
      }
    }
  }, [event, chartRef, seriesRef])

  if (!pos || dismissed) return null

  // Win → +profit (green). Loss → -stake (red). Tie/cancel → 0 (neutral
  // green — won is false at that point so we still show the amount lost,
  // which on a tie is 0).
  const pnl  = event.won ? (event.profit ?? 0) : -event.amount
  const sign = pnl > 0 ? '+' : pnl < 0 ? '-' : ''
  const abs  = Math.abs(pnl)

  return (
    <>
      {/* Card to the LEFT of the expiry dot — single rounded panel with
          dismiss X in the top-right corner. */}
      <div
        className="absolute z-[7]"
        style={{
          left:      pos.x - 10,
          top:       pos.y,
          transform: 'translate(-100%, -50%)',
        }}
      >
        {/* Compact card — title + amount sized for at-a-glance reading
            without dominating the chart. pr-5 leaves just enough room for
            the X (size 11, right-1) without the previous dead space. */}
        <div className={cn(
          'relative rounded-lg shadow-xl pointer-events-auto pl-3 pr-5 py-1.5',
          event.won ? 'bg-[#16a34a]' : 'bg-[#dc2626]'
        )}>
          <button
            onClick={() => setDismissed(true)}
            className="absolute top-0.5 right-1 text-white/70 hover:text-white transition-colors leading-none"
            aria-label="Fechar"
          >
            <X size={11} />
          </button>
          <div className="text-[9px] text-white tracking-wider font-bold uppercase leading-tight whitespace-nowrap">
            Resultado (L/P)
          </div>
          <div className="text-[14px] font-extrabold leading-tight mt-0.5 text-white whitespace-nowrap">
            {sign}R$ {abs.toFixed(2).replace('.', ',')}
          </div>
        </div>
      </div>

      {/* Dot at the chart position where the trade ended */}
      <div
        className="absolute z-[6] pointer-events-none"
        style={{ left: pos.x - 5, top: pos.y - 5 }}
      >
        <div className={cn(
          'w-3 h-3 rounded-full ring-2 ring-[#151822]',
          event.won ? 'bg-[#26a69a]' : 'bg-[#ef5350]'
        )} />
      </div>
    </>
  )
}

// ── DrawingOverlay ──────────────────────────────────────────────────────────
// Renders vertical line / trend line / fibonacci as an SVG overlay positioned
// in chart pixel space. Subscribes to visible-range changes + uses a low-rate
// timer to also pick up price-scale shifts (autoScale recalcs, etc.).
interface DrawingOverlayProps {
  drawing:      Exclude<Drawing, { type: 'h-line' }>
  chartRef:     React.MutableRefObject<any>
  seriesRef:    React.MutableRefObject<any>
  containerRef: React.RefObject<HTMLDivElement | null>
}

function DrawingOverlay({ drawing, chartRef, seriesRef, containerRef }: DrawingOverlayProps) {
  // Force re-render when chart range / size changes. Value unused — the
  // setter triggers a render which re-reads chart coords below.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!chartRef.current) return
    const update = () => setTick(t => t + 1)
    const ts = chartRef.current.timeScale()
    try { ts.subscribeVisibleLogicalRangeChange(update) } catch {}
    // Polling catches price-scale autoScale shifts that don't fire a range event.
    const interval = setInterval(update, 250)
    return () => {
      try { ts.unsubscribeVisibleLogicalRangeChange(update) } catch {}
      clearInterval(interval)
    }
  }, [chartRef])

  const chart     = chartRef.current
  const series    = seriesRef.current
  const container = containerRef.current
  if (!chart || !series || !container) return null
  const w = container.clientWidth
  const h = container.clientHeight

  if (drawing.type === 'v-line') {
    const x = chart.timeScale().timeToCoordinate(drawing.time)
    if (x == null) return null
    return (
      <svg className="absolute inset-0 z-20 pointer-events-none" width={w} height={h}>
        <line x1={x} y1={0} x2={x} y2={h} stroke={DRAWING_DEFAULT_COLOR} strokeWidth={1} />
      </svg>
    )
  }

  if (drawing.type === 'trend') {
    const x1 = chart.timeScale().timeToCoordinate(drawing.p1.time)
    const x2 = chart.timeScale().timeToCoordinate(drawing.p2.time)
    const y1 = series.priceToCoordinate(drawing.p1.price)
    const y2 = series.priceToCoordinate(drawing.p2.price)
    if (x1 == null || x2 == null || y1 == null || y2 == null) return null
    return (
      <svg className="absolute inset-0 z-20 pointer-events-none" width={w} height={h}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DRAWING_DEFAULT_COLOR} strokeWidth={2} />
        <circle cx={x1} cy={y1} r={3} fill={DRAWING_DEFAULT_COLOR} />
        <circle cx={x2} cy={y2} r={3} fill={DRAWING_DEFAULT_COLOR} />
      </svg>
    )
  }

  // Fibonacci: levels run from p1.price (ratio 0) to p2.price (ratio 1).
  const x1 = chart.timeScale().timeToCoordinate(drawing.p1.time)
  const x2 = chart.timeScale().timeToCoordinate(drawing.p2.time)
  if (x1 == null || x2 == null) return null
  const xLeft  = Math.min(x1, x2)
  const xRight = Math.max(x1, x2)
  const range  = drawing.p2.price - drawing.p1.price

  return (
    <svg className="absolute inset-0 z-20 pointer-events-none" width={w} height={h}>
      {FIB_LEVELS.map((lvl) => {
        const lvlPrice = drawing.p1.price + range * lvl.ratio
        const y = series.priceToCoordinate(lvlPrice)
        if (y == null) return null
        return (
          <g key={lvl.ratio}>
            <line
              x1={xLeft} y1={y} x2={xRight} y2={y}
              stroke={lvl.color} strokeWidth={1} strokeDasharray="4 3"
            />
            <text x={xRight + 4} y={y + 3} fill={lvl.color} fontSize="10" fontWeight="bold">
              {lvl.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── PendingPointMarker ──────────────────────────────────────────────────────
// Small visual confirmation of the 1st click while waiting for the 2nd
// (trend / fib). Re-positions on chart pan/zoom.
interface PendingPointMarkerProps {
  point:     DrawingPoint
  chartRef:  React.MutableRefObject<any>
  seriesRef: React.MutableRefObject<any>
}

function PendingPointMarker({ point, chartRef, seriesRef }: PendingPointMarkerProps) {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!chartRef.current) return
    const update = () => setTick(t => t + 1)
    const ts = chartRef.current.timeScale()
    try { ts.subscribeVisibleLogicalRangeChange(update) } catch {}
    const interval = setInterval(update, 250)
    return () => {
      try { ts.unsubscribeVisibleLogicalRangeChange(update) } catch {}
      clearInterval(interval)
    }
  }, [chartRef])

  const chart  = chartRef.current
  const series = seriesRef.current
  if (!chart || !series) return null
  const x = chart.timeScale().timeToCoordinate(point.time)
  const y = series.priceToCoordinate(point.price)
  if (x == null || y == null) return null

  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{ left: x - 5, top: y - 5 }}
    >
      <div
        className="w-2.5 h-2.5 rounded-full ring-2 ring-white animate-pulse"
        style={{ backgroundColor: DRAWING_DEFAULT_COLOR }}
      />
    </div>
  )
}
