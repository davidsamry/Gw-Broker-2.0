'use client'

import { X, ArrowRight } from 'lucide-react'
import { type Asset } from '@/lib/mockData'

interface AssetInfoModalProps {
  asset: Asset
  marketPrice?: number
  onClose: () => void
  onTrade: () => void
}

const SCHEDULE = [
  { date: '20 Maio', day: 'Quarta-feira' },
  { date: '21 Maio', day: 'Quinta-feira' },
  { date: '22 Maio', day: 'Sexta-feira' },
  { date: '23 Maio', day: 'Sábado' },
  { date: '24 Maio', day: 'Domingo' },
  { date: '25 Maio', day: 'Segunda-feira' },
  { date: '26 Maio', day: 'Terça-feira' },
]

const CHANGES = [
  { label: '5 minutos de mudança', value: -0.06 },
  { label: '60 minutos de mudança', value: -0.24 },
  { label: '1 dia de mudança', value: +0.39 },
]

const BOTTOM_STATS = [
  { label: '1 mês de mudança', value: -1.03 },
  { label: '1 ano de mudança', value: -1.12 },
  { label: 'Alteração anual', value: -0.16 },
]

/* Simple SVG mini-chart placeholder */
function MiniChart() {
  const points = [80, 60, 75, 55, 70, 45, 65, 50, 60, 40, 55, 45, 50, 35, 48, 30, 45, 35, 40]
  const w = 400
  const h = 120
  const step = w / (points.length - 1)
  const min = Math.min(...points)
  const max = Math.max(...points)
  const scaleY = (v: number) => h - ((v - min) / (max - min)) * h

  const d = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${scaleY(v)}`)
    .join(' ')

  const fill = `${d} L ${(points.length - 1) * step} ${h} L 0 ${h} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a5568" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#4a5568" stopOpacity="0.05" />
        </linearGradient>
        <pattern id="diagonal" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="#3a3f50" strokeWidth="4" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#diagonal)" />
      <path d={fill} fill="url(#chartGrad)" />
      <path d={d} fill="none" stroke="#6b7280" strokeWidth="1.5" />
    </svg>
  )
}

export function AssetInfoModal({ asset, marketPrice, onClose, onTrade }: AssetInfoModalProps) {
  const sellPct = 63
  const buyPct = 37

  return (
    // Outer overlay: clicking outside the card closes (matches other modals).
    // Mobile top padding kept small so the card fits the viewport on phones;
    // desktop pushes it down a bit so it sits below the trading header.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-4 md:pt-16 bg-black/50 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[#1e2235] rounded-2xl border border-[#2a2e3b] shadow-2xl w-full max-w-[820px] my-4 md:my-0"
      >

        {/* Close button — outside card, top-left on desktop; floats inside on mobile so it doesn't get cut off */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 md:-top-3 md:-left-3 md:right-auto w-8 h-8 bg-[#1e2235] border border-[#2a2e3b] rounded-full flex items-center justify-center text-[#8b8f9a] hover:text-white transition-colors z-10 shadow-lg"
        >
          <X size={14} />
        </button>

        {/* Stacks on mobile, two-column on md+. */}
        <div className="flex flex-col md:flex-row min-h-0">
          {/* Left column — main info */}
          <div className="flex-1 p-4 md:p-5 flex flex-col gap-4 md:border-r border-b md:border-b-0 border-[#2a2e3b]">

            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap pr-10 md:pr-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-2xl">{asset.flag1}{asset.flag2}</span>
                <span className="text-base font-bold text-white truncate">{asset.label}</span>
                <span className="text-base font-bold text-orange-400">{asset.payout}%</span>
              </div>
              <div className="text-xs text-[#8b8f9a]">
                <span className="text-white font-medium">Abra agora</span>
                {' '}/ Fecha hoje às 20:59
              </div>
            </div>

            <div className="h-px border-t border-dashed border-[#2a2e3b]" />

            {/* Price + session change + CTA — stack on mobile, row on md+ */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
              <div>
                <div className="text-[11px] text-[#8b8f9a] mb-1">Preço agora</div>
                <div className="text-xl font-bold text-white font-mono">
                  {(marketPrice ?? asset.price).toFixed((marketPrice ?? asset.price) > 10 ? 3 : 5)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#8b8f9a] mb-1">Alteração de sessão</div>
                <div className="text-base font-bold text-red-400">-1.39%</div>
              </div>
              <div className="sm:ml-auto">
                <button
                  onClick={onTrade}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-500 transition-colors rounded-lg text-sm font-bold text-white"
                >
                  Negocie agora
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>

            {/* Sentiment bar */}
            <div className="bg-[#252a3a] rounded-xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-white">Vender</div>
                  <div className="text-[10px] text-[#8b8f9a] mt-0.5">Sentimento dos<br />comerciantes</div>
                </div>
                <div className="text-sm font-bold text-white">{buyPct}%</div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-red-400">{sellPct}%</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-red-500 rounded-l-full"
                    style={{ width: `${sellPct}%` }}
                  />
                  <div
                    className="h-full bg-green-500 rounded-r-full"
                    style={{ width: `${buyPct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-green-400">{buyPct}%</span>
              </div>
            </div>

            {/* Stats grid — 2 cols on mobile, 4 on md+ */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div>
                <div className="text-[11px] text-[#8b8f9a] mb-1">Investimento mínimo</div>
                <div className="text-sm font-bold text-white">R$5</div>
              </div>
              <div>
                <div className="text-[11px] text-[#8b8f9a] mb-1">Lucro - 1 min</div>
                <div className="text-sm font-bold text-green-400">{asset.payout}%</div>
              </div>
              <div>
                <div className="text-[11px] text-[#8b8f9a] mb-1">Lucro - 5 min</div>
                <div className="text-sm font-bold text-green-400">{asset.payout}%</div>
              </div>
              <div>
                <div className="text-[11px] text-[#8b8f9a] mb-1">Tempo de expiração</div>
                <div className="text-sm font-bold text-white">1 min, 5 min ou 15 min</div>
              </div>
            </div>

            {/* Change cards + mini chart — stack on mobile */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Change cards: column on mobile too (vertical), but full width */}
              <div className="flex flex-col gap-2 w-full sm:w-[180px] sm:flex-shrink-0">
                {CHANGES.map((c) => (
                  <div key={c.label} className="bg-[#252a3a] rounded-lg px-3 py-2">
                    <div className="text-[10px] text-[#8b8f9a] leading-tight mb-1">{c.label}</div>
                    <div className={`text-sm font-bold ${c.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {c.value >= 0 ? '+' : ''}{c.value.toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>

              {/* Mini chart */}
              <div className="flex-1 bg-[#252a3a] rounded-lg overflow-hidden h-[120px]">
                <MiniChart />
              </div>
            </div>

            {/* Bottom stats — wrap on narrow screens */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:gap-6 pt-2 border-t border-[#2a2e3b]">
              {BOTTOM_STATS.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5 text-xs">
                  <span className="text-[#8b8f9a]">{s.label}</span>
                  <span className={s.value >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                    {s.value >= 0 ? '+' : ''}{s.value.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right column — schedule (full width on mobile, fixed 280px on md+) */}
          <div className="w-full md:w-[280px] md:flex-shrink-0 p-4 md:p-5">
            <div className="text-sm font-bold text-white mb-4">Cronograma de Negociação</div>

            <div className="grid grid-cols-3 gap-1 mb-2">
              <div className="text-[10px] text-[#8b8f9a]">Encontro</div>
              <div className="text-[10px] text-[#8b8f9a]">Dia da semana</div>
              <div className="text-[10px] text-[#8b8f9a]">Horário de Negociação</div>
            </div>

            <div className="flex flex-col gap-0">
              {SCHEDULE.map((row, i) => (
                <div
                  key={row.date}
                  className={`grid grid-cols-3 gap-1 py-2 text-xs border-t border-[#2a2e3b] ${
                    i === 0 ? 'text-white' : 'text-[#8b8f9a]'
                  }`}
                >
                  <div className="font-medium">{row.date}</div>
                  <div>{row.day}</div>
                  <div>21:00 - 20:59</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
