import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg'

interface LogoProps {
  size?:     Size
  subtitle?: boolean
  className?: string
}

// Heights of the wordmark image at each size. The image (vx-logo.png in /public)
// already contains the "V↗ Vx Global" mark — we just scale it.
const SIZES: Record<Size, { height: number; sub: string }> = {
  sm: { height: 34, sub: 'text-[8px]' },
  md: { height: 28, sub: 'text-[9px]' },
  lg: { height: 40, sub: 'text-[10px]' },
}

export function Logo({ size = 'md', subtitle = false, className }: LogoProps) {
  const s = SIZES[size]
  return (
    <div className={cn('flex items-center gap-2 flex-shrink-0', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/vx-logo.png"
        alt="VX Global"
        height={s.height}
        style={{ height: s.height, width: 'auto' }}
        className="object-contain select-none"
        draggable={false}
      />
    </div>
  )
}
