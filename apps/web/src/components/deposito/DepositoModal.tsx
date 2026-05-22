'use client'

import { useState } from 'react'
import { X, ChevronRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DepositoModalProps {
  onClose: () => void
}

type Category = 'popular' | 'epay' | 'cripto'

/* ─── payment method icons ─── */
function CryptoIcon({ symbol, bg, text }: { symbol: string; bg: string; text: string }) {
  return (
    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white', bg)}>
      {text}
    </div>
  )
}

function PixIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#32BCAD" />
      <path d="M20.5 11.5L16 16l-4.5-4.5m9 9L16 16l4.5 4.5m-9 0L16 16l-4.5 4.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function UsdtIcon({ size = 32 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-[#26A17B] flex items-center justify-center flex-shrink-0">
      <span className="text-white text-xs font-bold">₮</span>
    </div>
  )
}

function BtcIcon({ size = 32 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-[#F7931A] flex items-center justify-center flex-shrink-0">
      <span className="text-white text-xs font-bold">₿</span>
    </div>
  )
}

function BnbIcon({ size = 32 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-[#F3BA2F] flex items-center justify-center flex-shrink-0">
      <span className="text-white text-[10px] font-bold">BNB</span>
    </div>
  )
}

function TrxIcon({ size = 32 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-red-600 flex items-center justify-center flex-shrink-0">
      <span className="text-white text-[10px] font-bold">TRX</span>
    </div>
  )
}

function LtcIcon({ size = 32 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="rounded-full bg-[#345D9D] flex items-center justify-center flex-shrink-0">
      <span className="text-white text-xs font-bold">Ł</span>
    </div>
  )
}

type PaymentMethod = {
  id: string
  name: string
  min: string
  icon: React.ReactNode
  lastUsed?: boolean
}

const POPULAR_METHODS: PaymentMethod[] = [
  { id: 'usdt-trc20',  name: 'USDT (TRC-20)', min: 'Min. R$76.00',  icon: <UsdtIcon />, lastUsed: true },
  { id: 'pix',         name: 'PIX',            min: 'Min. R$51.00',  icon: <PixIcon /> },
  { id: 'binance',     name: 'Binance Pay',    min: 'Min. R$51.00',  icon: <BnbIcon /> },
  { id: 'usdt-bep20',  name: 'USDT (BEP-20)',  min: 'Min. R$101.00', icon: <UsdtIcon /> },
  { id: 'btc',         name: 'Bitcoin (BTC)',   min: 'Min. R$50.00',  icon: <BtcIcon /> },
  { id: 'trx',         name: 'Tron (TRX)',      min: 'Min. R$76.00',  icon: <TrxIcon /> },
  { id: 'ltc',         name: 'Litecoin (LTC)',  min: 'Min. R$50.00',  icon: <LtcIcon /> },
  { id: 'usdt-erc20',  name: 'USDT (ERC-20)',   min: 'Min. R$252.00', icon: <UsdtIcon /> },
]

const EPAY_METHODS: PaymentMethod[] = [
  { id: 'pix-epay', name: 'PIX', min: 'Min. R$51.00', icon: <PixIcon /> },
]

const CRIPTO_METHODS: PaymentMethod[] = [
  { id: 'usdt-trc20-c',  name: 'USDT (TRC-20)', min: 'Min. R$76.00',  icon: <UsdtIcon /> },
  { id: 'binance-c',     name: 'Binance Pay',    min: 'Min. R$51.00',  icon: <BnbIcon /> },
  { id: 'btc-c',         name: 'Bitcoin (BTC)',   min: 'Min. R$50.00',  icon: <BtcIcon /> },
  { id: 'usdt-bep20-c',  name: 'USDT (BEP-20)',  min: 'Min. R$101.00', icon: <UsdtIcon /> },
  { id: 'ltc-c',         name: 'Litecoin (LTC)',  min: 'Min. R$50.00',  icon: <LtcIcon /> },
  { id: 'trx-c',         name: 'Tron (TRX)',      min: 'Min. R$76.00',  icon: <TrxIcon /> },
  { id: 'usdt-erc20-c',  name: 'USDT (ERC-20)',   min: 'Min. R$252.00', icon: <UsdtIcon /> },
]

function MethodCard({ method, onSelect }: { method: PaymentMethod; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1e2235] border border-[#2a2e3b] hover:border-blue-500/40 transition-colors text-left w-full"
    >
      {method.icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">{method.name}</div>
        {method.lastUsed ? (
          <div className="flex items-center gap-1 mt-0.5">
            <Clock size={10} className="text-[#8b8f9a]" />
            <span className="text-[10px] text-[#8b8f9a]">Usado por último</span>
          </div>
        ) : (
          <div className="text-[10px] text-[#8b8f9a] mt-0.5">{method.min}</div>
        )}
      </div>
      {method.lastUsed ? (
        <button className="px-3 py-1 rounded-lg bg-green-600 hover:bg-green-500 text-xs font-bold text-white transition-colors flex-shrink-0">
          Repetir
        </button>
      ) : (
        <ChevronRight size={14} className="text-[#8b8f9a] flex-shrink-0" />
      )}
    </button>
  )
}

const CATEGORIES = [
  {
    key: 'popular' as Category,
    label: 'POPULAR',
    count: 8,
    icons: [<UsdtIcon size={20} />, <BnbIcon size={20} />, <PixIcon size={20} />, <BtcIcon size={20} />],
    extra: 3,
    activeBg: 'bg-green-600',
    iconBg: 'bg-green-600/20',
    flag: 'br',
  },
  {
    key: 'epay' as Category,
    label: 'E-PAY',
    count: 1,
    icons: [<PixIcon size={20} />],
    extra: 0,
    iconBg: 'bg-[#2a2e3b]',
  },
  {
    key: 'cripto' as Category,
    label: 'CRIPTO',
    count: 17,
    icons: [<UsdtIcon size={20} />, <BnbIcon size={20} />, <BtcIcon size={20} />, <LtcIcon size={20} />, <UsdtIcon size={20} />],
    extra: 12,
    iconBg: 'bg-[#2a2e3b]',
  },
]

export function DepositoModal({ onClose }: DepositoModalProps) {
  const [category, setCategory] = useState<Category>('popular')

  const getMethodsForCategory = () => {
    if (category === 'epay')   return { sections: [{ title: `E-Pay (${EPAY_METHODS.length})`,   methods: EPAY_METHODS }] }
    if (category === 'cripto') return { sections: [{ title: `Cripto (${CRIPTO_METHODS.length})`, methods: CRIPTO_METHODS }] }
    return {
      sections: [
        { title: `Popular na sua região (${POPULAR_METHODS.length})`, methods: POPULAR_METHODS },
        { title: `E-Pay (${EPAY_METHODS.length})`,                     methods: EPAY_METHODS },
        { title: `Cripto (${CRIPTO_METHODS.length})`,                   methods: CRIPTO_METHODS.slice(0, 2) },
      ],
    }
  }

  const { sections } = getMethodsForCategory()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="relative bg-[#151822] rounded-2xl shadow-2xl border border-[#2a2e3b] w-[860px] max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#2a2e3b] flex-shrink-0">
          <h2 className="text-xl font-bold text-white">Depósito</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Left — categories */}
          <div className="w-[260px] flex-shrink-0 p-4 flex flex-col gap-3 border-r border-[#2a2e3b]">
            {CATEGORIES.map((cat) => {
              const isActive = category === cat.key
              return (
                <button
                  key={cat.key}
                  onClick={() => setCategory(cat.key)}
                  className={cn(
                    'flex flex-col gap-3 px-4 py-4 rounded-xl text-left transition-colors border',
                    isActive
                      ? 'bg-green-600 border-green-500'
                      : 'bg-[#1a1e2e] border-[#2a2e3b] hover:border-blue-500/30'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {cat.key === 'popular' ? (
                      <img src="https://flagcdn.com/w40/br.png" className="w-6 h-6 rounded-full object-cover" />
                    ) : cat.key === 'epay' ? (
                      <div className="w-6 h-6 rounded bg-[#3a3f50] flex items-center justify-center">
                        <span className="text-[#8b8f9a] text-[10px] font-bold">EP</span>
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[#3a3f50] flex items-center justify-center">
                        <span className="text-[#8b8f9a] text-[9px] font-bold">⬡</span>
                      </div>
                    )}
                    <div>
                      <div className={cn('text-sm font-bold', isActive ? 'text-white' : 'text-white')}>
                        {cat.label}
                      </div>
                      <div className={cn('text-[10px]', isActive ? 'text-green-100' : 'text-[#8b8f9a]')}>
                        {cat.count} métodos
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {cat.icons.map((icon, i) => (
                      <div key={i} className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0">
                        {icon}
                      </div>
                    ))}
                    {cat.extra > 0 && (
                      <div className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0',
                        isActive ? 'bg-green-500 text-white' : 'bg-[#2a2e3b] text-[#8b8f9a]'
                      )}>
                        +{cat.extra}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right — methods */}
          <div className="flex-1 overflow-y-auto p-5">
            {sections.map((section) => (
              <div key={section.title} className="mb-6">
                <h3 className="text-sm font-bold text-white mb-3">{section.title}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {section.methods.map((method) => (
                    <MethodCard key={method.id} method={method} onSelect={() => {}} />
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}
