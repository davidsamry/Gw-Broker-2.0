interface FlagPairProps {
  code1: string  // country code (e.g. 'us') OR 'crypto:btc' for crypto icons
  code2: string
  size?: number
}

function getImgSrc(code: string): string {
  if (code.startsWith('crypto:')) {
    const symbol = code.replace('crypto:', '')
    return `https://assets.coincap.io/assets/icons/${symbol}@2x.png`
  }
  return `https://flagcdn.com/w40/${code}.png`
}

export function FlagPair({ code1, code2, size = 22 }: FlagPairProps) {
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
