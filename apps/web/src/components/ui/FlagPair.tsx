import { Coins, Droplet, Flame, Wheat, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FlagPairProps {
  code1: string  // country code (e.g. 'us'), 'crypto:btc', 'asset:gold', or 'stock:aapl'
  code2: string  // ignored when code1 is single-asset/single-stock mode
  size?: number
}

// Ticker → company domain for Clearbit logo lookup. Add a new line per
// new stock symbol; the company's main marketing domain is what
// Clearbit uses to fetch the official logo.
const STOCK_DOMAINS: Record<string, string> = {
  aapl:  'apple.com',
  msft:  'microsoft.com',
  googl: 'google.com',
  amzn:  'amazon.com',
  tsla:  'tesla.com',
  meta:  'meta.com',
  nvda:  'nvidia.com',
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
  // Indices — no company logo; use a chart icon themed by the exchange.
  nasdaq:   { Icon: BarChart3, bg: 'bg-sky-700',   fg: 'text-sky-100'  },
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

  // Stock mode — render the company's official logo via Clearbit. Wraps
  // the logo on a white circular tile so dark-themed logos and light-
  // themed logos both pop against the panel's dark background.
  if (code1.startsWith('stock:')) {
    const ticker = code1.replace('stock:', '')
    const domain = STOCK_DOMAINS[ticker]
    if (domain) {
      return (
        <div
          className="flex-shrink-0 rounded-full overflow-hidden bg-white border-2 border-[#1a1e2e] flex items-center justify-center"
          style={{ width: size, height: size }}
        >
          <img
            src={`https://logo.clearbit.com/${domain}`}
            alt={ticker}
            style={{
              width:     Math.round(size * 0.82),
              height:    Math.round(size * 0.82),
              objectFit: 'contain',
            }}
            // If Clearbit ever 404s for a ticker, the broken-image icon
            // would look worse than the blank tile — swap to a 1px
            // transparent gif so the white circle stays clean. The
            // ticker text right next to it identifies the asset anyway.
            onError={(e) => {
              const img = e.currentTarget
              img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
            }}
          />
        </div>
      )
    }
    // Unknown stock ticker — fall through to dual-flag default.
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
