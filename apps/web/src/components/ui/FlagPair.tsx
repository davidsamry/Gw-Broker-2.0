import { Coins, Droplet, Flame, Wheat } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FlagPairProps {
  code1: string  // country code (e.g. 'us'), 'crypto:btc', or 'asset:gold'
  code2: string  // ignored when code1 is single-asset mode
  size?: number
}

// ── Single-asset icon registry ───────────────────────────────────────────
// Used when code1 starts with 'asset:' — renders ONE round badge with a
// themed background + Lucide icon instead of the dual-flag layout. Picks
// the symbol's natural visual: gold = warm amber, oil = black droplet,
// natgas = blue flame, etc.
const ASSET_ICONS: Record<string, {
  Icon: typeof Coins
  bg:    string  // tailwind bg class
  fg:    string  // tailwind text class for the icon
}> = {
  gold:     { Icon: Coins,   bg: 'bg-amber-500',  fg: 'text-amber-100' },
  silver:   { Icon: Coins,   bg: 'bg-gray-400',   fg: 'text-gray-50'   },
  copper:   { Icon: Coins,   bg: 'bg-orange-700', fg: 'text-orange-50' },
  platinum: { Icon: Coins,   bg: 'bg-slate-300',  fg: 'text-slate-700' },
  oil:      { Icon: Droplet, bg: 'bg-stone-900',  fg: 'text-stone-100' },
  brent:    { Icon: Droplet, bg: 'bg-stone-900',  fg: 'text-stone-100' },
  natgas:   { Icon: Flame,   bg: 'bg-blue-600',   fg: 'text-blue-100'  },
  wheat:    { Icon: Wheat,   bg: 'bg-yellow-600', fg: 'text-yellow-50' },
}

function getImgSrc(code: string): string {
  if (code.startsWith('crypto:')) {
    const symbol = code.replace('crypto:', '')
    return `https://assets.coincap.io/assets/icons/${symbol}@2x.png`
  }
  return `https://flagcdn.com/w40/${code}.png`
}

export function FlagPair({ code1, code2, size = 22 }: FlagPairProps) {
  // Single-asset mode — render one centered round badge with a Lucide icon.
  // Triggered by 'asset:gold', 'asset:silver', etc. code2 is ignored.
  if (code1.startsWith('asset:')) {
    const key    = code1.replace('asset:', '')
    const config = ASSET_ICONS[key]
    if (config) {
      const { Icon } = config
      return (
        <div
          className={cn(
            'flex-shrink-0 rounded-full flex items-center justify-center border-2 border-[#1a1e2e]',
            config.bg,
          )}
          style={{ width: size, height: size }}
        >
          <Icon
            size={Math.round(size * 0.6)}
            className={config.fg}
            strokeWidth={2.2}
          />
        </div>
      )
    }
    // Unknown asset key — fall through to dual-flag rendering with a
    // neutral placeholder so the row doesn't crash.
  }

  // Dual-flag mode — forex pairs (us/eu, gb/jp) and crypto pairs (btc/us).
  const offset = Math.round(size * 0.55)
  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size + offset, height: size }}
    >
      <img
        src={getImgSrc(code1)}
        alt={code1}
        width={size}
        height={size}
        className="absolute left-0 top-0 rounded-full object-cover border-2 border-[#1a1e2e] z-10"
        style={{ width: size, height: size }}
      />
      <img
        src={getImgSrc(code2)}
        alt={code2}
        width={size}
        height={size}
        className="absolute top-0 rounded-full object-cover border-2 border-[#1a1e2e] z-0"
        style={{ width: size, height: size, left: offset }}
      />
    </div>
  )
}
