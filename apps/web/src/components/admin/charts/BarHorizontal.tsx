// Horizontal bar comparator used in the "Quantidade de Operações" panel.
// 2 rows (Vitórias / Derrotas). Bars scale to the max value.

interface BarHorizontalProps {
  userWins:   number
  userLosses: number
}

export function BarHorizontal({ userWins, userLosses }: BarHorizontalProps) {
  const max = Math.max(1, userWins, userLosses)
  const ticks = [0, max * 0.25, max * 0.5, max * 0.75, max].map(Math.round)

  return (
    <div className="w-full">
      <div className="flex flex-col gap-4">
        <BarRow label="Vitórias Usuários" value={userWins}   max={max} color="#ef4444" />
        <BarRow label="Derrotas Usuários" value={userLosses} max={max} color="#22c55e" />
      </div>

      {/* X-axis ticks */}
      <div className="flex justify-between mt-2 ml-[140px]">
        {ticks.map((t) => (
          <span key={t} className="text-[10px] text-[#8b8f9a]">{t}</span>
        ))}
      </div>

      <div className="flex justify-center gap-8 mt-5 text-center">
        <div>
          <div className="text-2xl font-bold text-red-400">{userWins}</div>
          <div className="text-[10px] text-[#8b8f9a] mt-1">Vitórias Usuários</div>
          <div className="text-[10px] text-[#8b8f9a]">(Perdas Plataforma)</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-emerald-400">{userLosses}</div>
          <div className="text-[10px] text-[#8b8f9a] mt-1">Derrotas Usuários</div>
          <div className="text-[10px] text-[#8b8f9a]">(Ganhos Plataforma)</div>
        </div>
      </div>
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = (value / max) * 100
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[#8b8f9a] w-[136px] text-right shrink-0">{label}</span>
      <div className="flex-1 h-8 bg-[#1a1e2a] rounded relative overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
    </div>
  )
}
