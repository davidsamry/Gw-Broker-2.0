// Area chart for the "Últimos 7 Dias" panel. Pure SVG. Renders two stacked
// series (Ganhos green, Perdas red) over a shared time axis. Auto-scales the
// Y axis to the max value in the data and labels the X axis with day labels.

interface DailyPoint { date: string; wins: number; losses: number }
interface AreaChartProps { data: DailyPoint[] }

export function AreaChart({ data }: AreaChartProps) {
  const w = 600
  const h = 220
  const padL = 48
  const padR = 16
  const padT = 12
  const padB = 28
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const max = Math.max(1, ...data.flatMap((p) => [p.wins, p.losses]))
  // Round max up to a nice tick to draw 4 gridlines.
  const niceMax = niceCeil(max)
  const ticks   = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax]

  const x = (i: number) => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH

  const winsPath  = pathFromPoints(data.map((p, i) => [x(i), y(p.wins)]))
  const lossPath  = pathFromPoints(data.map((p, i) => [x(i), y(p.losses)]))
  const winsFill  = areaFromPoints(data.map((p, i) => [x(i), y(p.wins)]),  padT + innerH)
  const lossFill  = areaFromPoints(data.map((p, i) => [x(i), y(p.losses)]),padT + innerH)

  return (
    <div className="w-full overflow-x-auto">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
        {/* Gridlines + Y-axis labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="#1f232e" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fill="#8b8f9a" fontSize="10">
              R${formatTick(t)}
            </text>
          </g>
        ))}

        {/* Area fills */}
        <path d={lossFill} fill="rgba(239,68,68,0.18)" />
        <path d={winsFill} fill="rgba(34,197,94,0.20)" />

        {/* Lines */}
        <path d={lossPath} fill="none" stroke="#ef4444" strokeWidth={2} />
        <path d={winsPath} fill="none" stroke="#22c55e" strokeWidth={2} />

        {/* Dots */}
        {data.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.wins)}   r={3} fill="#22c55e" />
            <circle cx={x(i)} cy={y(p.losses)} r={3} fill="#ef4444" />
            <text x={x(i)} y={h - 6} textAnchor="middle" fill="#8b8f9a" fontSize="10">
              {shortDay(p.date)}
            </text>
          </g>
        ))}
      </svg>

      <div className="flex items-center justify-center gap-6 mt-1 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-[#8b8f9a]">Ganhos</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-[#8b8f9a]">Perdas</span>
        </div>
      </div>
    </div>
  )
}

function pathFromPoints(points: number[][]) {
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
}

function areaFromPoints(points: number[][], baseY: number) {
  if (points.length === 0) return ''
  const top = pathFromPoints(points)
  const last  = points[points.length - 1][0]
  const first = points[0][0]
  return `${top} L ${last.toFixed(1)} ${baseY} L ${first.toFixed(1)} ${baseY} Z`
}

function niceCeil(n: number) {
  if (n <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(n)))
  const norm = n / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
}

function formatTick(v: number) {
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'
  return Math.round(v).toString()
}

function shortDay(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}
