// Drawing tool types + Fibonacci levels.
// Coords are in chart space: `time` is the UTC-seconds bar timestamp the chart
// uses internally (already shifted by BRT_OFFSET), `price` is the raw price.

export type DrawingToolId = 'h-line' | 'v-line' | 'trend' | 'fib'

export interface DrawingToolDef {
  id:    DrawingToolId
  label: string
  /** How many chart clicks to fully define this drawing. */
  steps: 1 | 2
}

export const DRAWING_TOOLS: DrawingToolDef[] = [
  { id: 'h-line', label: 'Linha horizontal',     steps: 1 },
  { id: 'v-line', label: 'Linha vertical',       steps: 1 },
  { id: 'trend',  label: 'Linha de tendência',   steps: 2 },
  { id: 'fib',    label: 'Retração de Fibonacci',steps: 2 },
]

export interface Point { time: number; price: number }

export type Drawing =
  | { id: string; type: 'h-line'; price: number }
  | { id: string; type: 'v-line'; time:  number }
  | { id: string; type: 'trend';  p1: Point; p2: Point }
  | { id: string; type: 'fib';    p1: Point; p2: Point }

export interface FibLevel { ratio: number; label: string; color: string }

export const FIB_LEVELS: FibLevel[] = [
  { ratio: 0,     label: '0',     color: '#9ca3af' },
  { ratio: 0.236, label: '23.6',  color: '#22c55e' },
  { ratio: 0.382, label: '38.2',  color: '#3b82f6' },
  { ratio: 0.5,   label: '50',    color: '#eab308' },
  { ratio: 0.618, label: '61.8',  color: '#f97316' },
  { ratio: 0.786, label: '78.6',  color: '#a855f7' },
  { ratio: 1,     label: '100',   color: '#9ca3af' },
]

export const DRAWING_DEFAULT_COLOR = '#3b82f6'
