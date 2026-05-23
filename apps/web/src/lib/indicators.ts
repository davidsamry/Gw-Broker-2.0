import type { Candle } from './marketTypes'

// ── Registry ────────────────────────────────────────────────────────────────
// Single source of truth for available indicators. Both the picker panel and
// the chart renderer iterate this list, so adding a new indicator only
// requires:
//   1. extend IndicatorType (and its branch in renderIndicator below)
//   2. append a new entry to INDICATORS
//   3. add a calc function

export type IndicatorType = 'sma' | 'ema' | 'bb' | 'rsi'

export interface IndicatorDef {
  id:      string
  label:   string
  type:    IndicatorType
  period:  number
  stdDev?: number
  color:   string
}

export const INDICATORS: IndicatorDef[] = [
  { id: 'sma-9',   label: 'SMA 9',     type: 'sma', period: 9,   color: '#3b82f6' },  // blue
  { id: 'sma-21',  label: 'SMA 21',    type: 'sma', period: 21,  color: '#f97316' },  // orange
  { id: 'sma-50',  label: 'SMA 50',    type: 'sma', period: 50,  color: '#a855f7' },  // purple
  { id: 'sma-200', label: 'SMA 200',   type: 'sma', period: 200, color: '#ec4899' },  // pink
  { id: 'ema-9',   label: 'EMA 9',     type: 'ema', period: 9,   color: '#22c55e' },  // green
  { id: 'ema-21',  label: 'EMA 21',    type: 'ema', period: 21,  color: '#14b8a6' },  // teal
  { id: 'bb-20-2', label: 'BB (20,2)', type: 'bb',  period: 20, stdDev: 2, color: '#eab308' }, // yellow
  { id: 'rsi-14',  label: 'RSI (14)',  type: 'rsi', period: 14,  color: '#f43f5e' },  // rose
]

export function getIndicatorById(id: string): IndicatorDef | undefined {
  return INDICATORS.find((i) => i.id === id)
}

// ── Calculations ────────────────────────────────────────────────────────────
// All return arrays of { time, value } points aligned to candle times. Periods
// where the indicator is undefined (warm-up) are skipped, not zero-padded.

interface Point { time: number; value: number }

export function calculateSMA(candles: Candle[], period: number): Point[] {
  if (period <= 0) return []
  const out: Point[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) {
      out.push({ time: candles[i].time as number, value: round5(sum / period) })
    }
  }
  return out
}

export function calculateEMA(candles: Candle[], period: number): Point[] {
  if (period <= 0 || candles.length < period) return []
  const k = 2 / (period + 1)
  const out: Point[] = []
  // Seed EMA with the SMA of the first `period` closes.
  let ema = 0
  for (let i = 0; i < period; i++) ema += candles[i].close
  ema /= period
  out.push({ time: candles[period - 1].time as number, value: round5(ema) })
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k)
    out.push({ time: candles[i].time as number, value: round5(ema) })
  }
  return out
}

export interface BollingerBands {
  upper:  Point[]
  middle: Point[]
  lower:  Point[]
}

export function calculateBollingerBands(candles: Candle[], period: number, stdDev: number): BollingerBands {
  const bb: BollingerBands = { upper: [], middle: [], lower: [] }
  if (period <= 0) return bb
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1)
    const mean  = slice.reduce((s, c) => s + c.close, 0) / period
    const variance = slice.reduce((s, c) => s + (c.close - mean) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    const t = candles[i].time as number
    bb.middle.push({ time: t, value: round5(mean) })
    bb.upper .push({ time: t, value: round5(mean + stdDev * sd) })
    bb.lower .push({ time: t, value: round5(mean - stdDev * sd) })
  }
  return bb
}

export function calculateRSI(candles: Candle[], period: number): Point[] {
  if (period <= 0 || candles.length <= period) return []
  const out: Point[] = []
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close
    if (diff >= 0) gainSum += diff
    else           lossSum += -diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out.push({
    time:  candles[period].time as number,
    value: avgLoss === 0 ? 100 : round5(100 - 100 / (1 + avgGain / avgLoss)),
  })
  // Wilder's smoothing for subsequent values.
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close
    const gain = diff > 0 ?  diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rs  = avgLoss === 0 ? Infinity : avgGain / avgLoss
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs)
    out.push({ time: candles[i].time as number, value: round5(rsi) })
  }
  return out
}

function round5(v: number) {
  return parseFloat(v.toFixed(5))
}
