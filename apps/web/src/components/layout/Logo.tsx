import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg'

interface LogoProps {
  size?:     Size
  subtitle?: boolean
  className?: string
}

const SIZES: Record<Size, { box: string; letters: string; word: string; sub: string }> = {
  sm: { box: 'w-6 h-6',  letters: 'text-[9px]',  word: 'text-sm',   sub: 'text-[8px]' },
  md: { box: 'w-7 h-7',  letters: 'text-[10px]', word: 'text-sm',   sub: 'text-[9px]' },
  lg: { box: 'w-9 h-9',  letters: 'text-[13px]', word: 'text-lg',   sub: 'text-[10px]' },
}

export function Logo({ size = 'md', subtitle = false, className }: LogoProps) {
  const s = SIZES[size]
  return (
    <div className={cn('flex items-center gap-2 flex-shrink-0', className)}>
      <div
        className={cn(
          s.box,
          'rounded-md flex items-center justify-center bg-gradient-to-br from-[#00bcd4] to-[#0091ea] shadow-md shadow-cyan-500/25 ring-1 ring-white/10',
        )}
      >
        <span className={cn(s.letters, 'text-white font-black tracking-tighter')}>VX</span>
      </div>
      <div className="leading-none">
        <span className={cn(s.word, 'text-white font-bold tracking-widest block')}>
          VX GLOBAL
        </span>
        {subtitle && (
          <div className={cn(s.sub, 'text-[#8b8f9a] tracking-widest font-medium mt-0.5')}>
            TRADING PLATFORM
          </div>
        )}
      </div>
    </div>
  )
}
