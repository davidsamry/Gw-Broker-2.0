import { cn } from '@/lib/utils'

interface KpiCardProps {
  label:     string
  value:     string
  hint?:     string
  icon:      React.ReactNode
  /** Tailwind class for the icon-tile bg/text — e.g. "bg-emerald-500/15 text-emerald-400" */
  tone?:     string
  /** Tailwind class for the value color — e.g. "text-emerald-400" */
  valueTone?: string
}

// Reusable KPI tile used across the Admin Dashboard. Just the shell + slots —
// formatting is the parent's job (we don't want this component to know about
// currency / locale).
export function KpiCard({ label, value, hint, icon, tone = 'bg-white/5 text-white', valueTone = 'text-white' }: KpiCardProps) {
  return (
    <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-4 flex flex-col gap-3 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#8b8f9a]">{label}</span>
        <span className={cn('w-7 h-7 rounded-md flex items-center justify-center', tone)}>
          {icon}
        </span>
      </div>
      <div>
        <div className={cn('text-2xl font-bold leading-tight', valueTone)}>{value}</div>
        {hint && <div className="text-[10px] text-[#8b8f9a] mt-1">{hint}</div>}
      </div>
    </div>
  )
}
