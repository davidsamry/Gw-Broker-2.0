'use client'

import { useState } from 'react'
import { Eye, ChevronDown } from 'lucide-react'

/* ─── Circular progress ring ─── */
function Ring({ value, max, percent, size = 72, stroke = 6, color = '#22c55e' }: {
  value: number; max?: number; percent?: number; size?: number; stroke?: number; color?: string
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const pct = percent ?? (max ? value / max : 0)
  const dash = circ * pct
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2e3b" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-white leading-none">{value}</span>
        {percent !== undefined && <span className="text-[9px] text-[#8b8f9a] mt-0.5">{Math.round(percent * 100)}%</span>}
      </div>
    </div>
  )
}

/* ─── Stat item ─── */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-base font-bold text-white mb-1">{value}</div>
      <div className="flex gap-0.5 mb-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-1 w-3 rounded-sm bg-[#2a2e3b]" />
        ))}
      </div>
      <div className="text-xs text-[#8b8f9a]">{label}</div>
    </div>
  )
}

/* ─── Area chart (SVG) ─── */
function AreaChart({ data, yMin, yMax, yLabels, xLabels, color = '#22c55e', height = 160 }: {
  data: number[]; yMin: number; yMax: number; yLabels: string[]; xLabels: string[]; color?: string; height?: number
}) {
  const W = 560; const H = height
  const padL = 52; const padR = 10; const padT = 10; const padB = 28
  const plotW = W - padL - padR; const plotH = H - padT - padB
  const n = data.length

  function xPos(i: number) { return padL + (i / (n - 1)) * plotW }
  function yPos(v: number) { return padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH }

  const pts = data.map((v, i) => `${xPos(i)},${yPos(v)}`).join(' ')
  const area = `M${xPos(0)},${yPos(0)} ` +
    data.map((v, i) => `L${xPos(i)},${yPos(v)}`).join(' ') +
    ` L${xPos(n - 1)},${yPos(yMin)} L${xPos(0)},${yPos(yMin)} Z`

  const yStep = plotH / (yLabels.length - 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {/* Grid lines */}
      {yLabels.map((_, i) => (
        <line key={i} x1={padL} x2={W - padR} y1={padT + i * yStep} y2={padT + i * yStep}
          stroke="#2a2e3b" strokeWidth="1" />
      ))}
      {/* Y labels */}
      {yLabels.map((l, i) => (
        <text key={i} x={padL - 6} y={padT + i * yStep + 4} textAnchor="end"
          className="fill-[#8b8f9a]" style={{ fontSize: 10 }}>{l}</text>
      ))}
      {/* Area fill */}
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#grad-${color})`} />
      {/* Line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      {/* X labels */}
      {xLabels.map((l, i) => {
        const idx = Math.round((i / (xLabels.length - 1)) * (n - 1))
        return (
          <text key={i} x={xPos(idx)} y={H - 6} textAnchor="middle"
            className="fill-[#8b8f9a]" style={{ fontSize: 9 }}>{l}</text>
        )
      })}
    </svg>
  )
}

/* ─── Bar chart ─── */
function BarChart({ bars }: { bars: { label: string; value: number }[] }) {
  const W = 480; const H = 200
  const padL = 40; const padR = 10; const padT = 10; const padB = 40
  const plotW = W - padL - padR; const plotH = H - padT - padB
  const minV = Math.min(...bars.map(b => b.value))
  const yLabels = ['0', '-2,5k', '-5k', '-7,5k', '-10k', '-12,5k', '-15k']
  const yMin = -15000; const yMax = 0
  const yStep = plotH / (yLabels.length - 1)
  const barW = (plotW / bars.length) * 0.5
  const barGap = plotW / bars.length

  function yPos(v: number) { return padT + ((v - yMax) / (yMin - yMax)) * plotH }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={padT + i * yStep} y2={padT + i * yStep} stroke="#2a2e3b" strokeWidth="1" />
          <text x={padL - 4} y={padT + i * yStep + 4} textAnchor="end" className="fill-[#8b8f9a]" style={{ fontSize: 9 }}>{l}</text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = padL + i * barGap + barGap / 2 - barW / 2
        const yTop = yPos(b.value)
        const yZero = yPos(0)
        return (
          <g key={i}>
            <rect x={x} y={yTop} width={barW} height={yZero - yTop} fill="#ef4444" rx="2" />
            <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-[#8b8f9a]" style={{ fontSize: 8 }}>{b.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/* ─── Donut chart ─── */
function DonutChart({ segments, size = 160 }: {
  segments: { label: string; pct: number; color: string }[]; size?: number
}) {
  const cx = size / 2; const cy = size / 2; const r = size * 0.35; const stroke = size * 0.16
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1e2e" strokeWidth={stroke + 2} />
        {segments.map((s, i) => {
          const dash = circ * s.pct / 100
          const gap = circ - dash
          const rot = (offset / 100) * 360 - 90
          offset += s.pct
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${gap}`}
              style={{ transform: `rotate(${rot}deg)`, transformOrigin: `${cx}px ${cy}px` }} />
          )
        })}
        <circle cx={cx} cy={cy} r={r * 0.52} fill="#151822" />
      </svg>
      <div className="flex flex-col gap-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-[#8b8f9a]">{s.label} <span className="text-white font-semibold">{s.pct}%</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Mock chart data ─── */
const xLabels = ['20. abr','22. abr','24. abr','26. abr','28. abr','30. abr','2. mai','4. mai','6. mai','8. mai','10. mai','12. mai','14. mai','16. mai','18. mai','20. mai']

const profitData = [
  -1200, -800, -400, -430, -600, -100, 50, 20, 10, 30, 0, 40, 20, 0, 8000, 55000,
]

const pctData = [
  0, 0, 5, 0, 90, 98, 0, 0, 0, 0, 0, 0, 0, 0, 0, 85,
]

const TOP5 = [
  { label: 'BRLUSD_otc', pct: 32, color: '#22c55e' },
  { label: 'USDBT_otc',  pct: 19, color: '#3b82f6' },
  { label: 'CADCHF_otc', pct: 17, color: '#6b7280' },
  { label: 'USDPKR_otc', pct: 16, color: '#ef4444' },
  { label: 'USDMXN_otc', pct: 15, color: '#f97316' },
]

const DIST = [
  { label: 'EURUSD',      pct: 92, color: '#6366f1' },
  { label: 'NZDCAD_otc',  pct: 3,  color: '#22c55e' },
  { label: 'ATOUSD_otc',  pct: 2,  color: '#3b82f6' },
  { label: 'EURGBP_otc',  pct: 2,  color: '#f97316' },
  { label: 'EURGBP',      pct: 2,  color: '#ef4444' },
]

const BARS = [
  { label: 'NZDCAD_otc',  value: -1800  },
  { label: 'ATOUSD_otc',  value: -2400  },
  { label: 'EURGBP_otc',  value: -3000  },
  { label: 'EURGBP',      value: -5000  },
  { label: 'EURUSD',      value: -13500 },
]

export function AnalisePage() {
  const [showDemo, setShowDemo] = useState(true)

  return (
    <div className="flex-1 flex flex-col bg-[#151822] min-h-0 overflow-hidden">

      {/* User info bar */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-[#2a2e3b] bg-[#1a1e2e] flex-shrink-0">
        {/* Avatar + info */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-blue-400 fill-current">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </div>
          <div>
            <div className="text-xs text-white">janielmadeira@gmail.com</div>
            <div className="flex items-center gap-1 text-xs text-[#8b8f9a]">
              ID: 10000001
              <span className="text-purple-400">💎</span>
            </div>
          </div>
        </div>

        <div className="w-px h-8 bg-[#2a2e3b]" />

        {/* Location */}
        <div>
          <div className="text-[10px] text-[#8b8f9a] mb-0.5">Localização</div>
          <div className="text-sm font-semibold text-white">Brazil</div>
        </div>

        <div className="w-px h-8 bg-[#2a2e3b]" />

        {/* Na conta */}
        <div>
          <div className="text-[10px] text-[#8b8f9a] mb-0.5">Na conta</div>
          <div className="text-sm font-semibold text-white">R$108.289,70</div>
        </div>

        <div className="w-px h-8 bg-[#2a2e3b]" />

        {/* Na demonstração */}
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[10px] text-[#8b8f9a] mb-0.5">Na demonstração</div>
            <div className="text-sm font-semibold text-white">R$45.411,50</div>
          </div>
          <button onClick={() => setShowDemo(!showDemo)} className="text-[#8b8f9a] hover:text-white transition-colors">
            <Eye size={16} />
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Period selector */}
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#2a2e3b] bg-[#1a1e2e] text-sm text-white hover:border-white/30 transition-colors">
          Mês <ChevronDown size={14} className="text-[#8b8f9a]" />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-full">

          {/* LEFT — Dados gerais + Top 5 */}
          <div className="w-[520px] flex-shrink-0 border-r border-[#2a2e3b] px-6 py-5 flex flex-col gap-6">

            {/* Dados gerais */}
            <div>
              <h2 className="text-sm font-bold text-white mb-4">Dados gerais</h2>

              {/* Row 1 */}
              <div className="grid grid-cols-3 gap-4 pb-4 border-b border-[#2a2e3b]">
                <div className="flex flex-col items-start gap-2">
                  <Ring value={422} max={422} size={68} />
                  <span className="text-xs text-[#8b8f9a]">Contagem de negociações</span>
                </div>
                <div className="pt-1">
                  <Stat value="25719.91 $" label="Lucro das negociações" />
                </div>
                <div className="flex flex-col items-start gap-2">
                  <Ring value={365} percent={0.86} size={68} />
                  <span className="text-xs text-[#8b8f9a]">Negociações lucrativas</span>
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-3 gap-4 py-4 border-b border-[#2a2e3b]">
                <Stat value="60.95 $"       label="Lucro médio" />
                <Stat value="112691.21 $"   label="Volume de negócios líquido" />
                <Stat value="0 $"           label="Negociações cobertas" />
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-3 gap-4 py-4 border-b border-[#2a2e3b]">
                <Stat value="0.97 $"     label="Valor mínimo de negociação" />
                <Stat value="2909.6 $"   label="Valor máximo de negociação" />
                <Stat value="2735.02 $"  label="Lucro comercial máximo" />
              </div>

              {/* Color scale */}
              <div className="flex items-center gap-3 mt-4">
                <div className="flex rounded overflow-hidden h-3">
                  {['#ef4444','#f97316','#eab308','#22c55e','#15803d'].map((c, i) => (
                    <div key={i} className="w-8" style={{ background: c }} />
                  ))}
                </div>
                <div className="flex gap-3 text-[10px] text-[#8b8f9a]">
                  <span>-1K-0</span>
                  <span>0-1K</span>
                  <span>+1K</span>
                </div>
              </div>
            </div>

            {/* Top 5 */}
            <div>
              <h2 className="text-sm font-bold text-white mb-4">Top 5 instrumentos mais rentáveis entre os traders</h2>
              <DonutChart segments={TOP5} size={180} />
            </div>

          </div>

          {/* RIGHT — Charts */}
          <div className="flex-1 px-6 py-5 flex flex-col gap-6 overflow-hidden">

            {/* Lucro chart */}
            <div>
              <h2 className="text-sm font-bold text-white mb-3">Estatísticas de negociações lucrativas</h2>
              <div className="bg-[#1a1e2e] rounded-xl border border-[#2a2e3b] p-3">
                <AreaChart
                  data={profitData}
                  yMin={-20000} yMax={60000}
                  yLabels={['60000','40000','20000','0','-20000']}
                  xLabels={xLabels}
                  height={170}
                />
              </div>
            </div>

            {/* Percentage chart */}
            <div>
              <h2 className="text-sm font-bold text-white mb-3">Porcentagem % de negociações lucrativas</h2>
              <div className="bg-[#1a1e2e] rounded-xl border border-[#2a2e3b] p-3">
                <AreaChart
                  data={pctData}
                  yMin={0} yMax={100}
                  yLabels={['100','75','50','25','0']}
                  xLabels={xLabels}
                  height={170}
                />
              </div>
            </div>

            {/* Bar + Donut row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h2 className="text-xs font-bold text-white mb-3">Estatísticas de Lucros e Perdas por instrumentos</h2>
                <div className="bg-[#1a1e2e] rounded-xl border border-[#2a2e3b] p-3">
                  <BarChart bars={BARS} />
                </div>
              </div>
              <div>
                <h2 className="text-xs font-bold text-white mb-3">Distribuição de negócios por instrumentos, %</h2>
                <div className="bg-[#1a1e2e] rounded-xl border border-[#2a2e3b] p-4">
                  <DonutChart segments={DIST} size={140} />
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
