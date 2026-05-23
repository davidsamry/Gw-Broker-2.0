// Donut chart for the Wins/Losses distribution. Pure SVG — no chart lib.
// Two slices, hovered on neither. Empty state when both values are 0.

interface DonutChartProps {
  wins:   number
  losses: number
}

export function DonutChart({ wins, losses }: DonutChartProps) {
  const total = wins + losses
  const size  = 160
  const r     = 60
  const stroke = 24
  const cx = size / 2
  const cy = size / 2

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[200px] text-[#8b8f9a] text-sm">
        Sem operações no período
      </div>
    )
  }

  // Circumference and slice lengths.
  const C = 2 * Math.PI * r
  const winLen = (wins / total) * C

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {/* Loss slice (red, full circle as base) */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="#ef4444" strokeWidth={stroke}
        />
        {/* Win slice (green, drawn over the top up to winLen) */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="#22c55e" strokeWidth={stroke}
          strokeDasharray={`${winLen} ${C - winLen}`}
          strokeDashoffset={0}
        />
      </svg>
      <div className="flex items-center gap-5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          <span className="text-[#8b8f9a]">Ganhos</span>
          <span className="font-semibold text-white">{wins}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
          <span className="text-[#8b8f9a]">Perdas</span>
          <span className="font-semibold text-white">{losses}</span>
        </div>
      </div>
    </div>
  )
}
