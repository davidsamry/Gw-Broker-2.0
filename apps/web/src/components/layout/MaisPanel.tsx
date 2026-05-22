'use client'

import { X, ChevronRight, ChevronLeft, Trophy, Radio, HelpCircle } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ASSETS, type Asset } from '@/lib/mockData'

interface MaisPanelProps {
  onClose: () => void
  onSelectAsset?: (asset: Asset) => void
}

type MaisView = 'menu' | 'top' | 'sinais' | 'analise'

/* ─── leaderboard mock data ─── */
const LEADERBOARD = [
  { pos: 1,  name: 'DREAM',        amount: '$30,000.00+', flag: 'us' },
  { pos: 2,  name: 'Canga...',     amount: '$30,000.00+', flag: 'br', isMe: true },
  { pos: 3,  name: 'زينب سوريا',   amount: '$30,000.00+', flag: 'sy' },
  { pos: 4,  name: 'VISION...',    amount: '$30,000.00+', flag: 'in' },
  { pos: 5,  name: 'Trader...',    amount: '$30,000.00+', flag: 'us' },
  { pos: 6,  name: 'Milan J...',   amount: '$30,000.00+', flag: 'rs' },
  { pos: 7,  name: 'C H I T...',  amount: '$30,000.00+', flag: 'in' },
  { pos: 8,  name: '#83462...',    amount: '$28,340.00',  flag: 'us' },
  { pos: 9,  name: 'Patty M...',   amount: '$26,799.52',  flag: 'ph' },
  { pos: 10, name: 'Borhan...',    amount: '$21,037.50',  flag: 'bd' },
  { pos: 11, name: 'أبو ناصر',    amount: '$20,978.65',  flag: 'sa' },
  { pos: 12, name: 'trader',       amount: '$18,607.25',  flag: 'tr' },
  { pos: 13, name: 'SK TRA...',    amount: '$17,640.00',  flag: 'id' },
  { pos: 14, name: 'MOSAL...',     amount: '$16,878.00',  flag: 'dz' },
  { pos: 15, name: 'RUTHLE...',    amount: '$15,229.00',  flag: 'us' },
]

const MEDAL_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: 'bg-yellow-500',  text: 'text-black' },
  2: { bg: 'bg-gray-400',    text: 'text-black' },
  3: { bg: 'bg-orange-700',  text: 'text-white' },
}

function Avatar({ flag }: { flag: string }) {
  return (
    <div className="relative w-7 h-7 flex-shrink-0">
      <img
        src={`https://flagcdn.com/w40/${flag}.png`}
        alt={flag}
        className="w-5 h-5 rounded-full object-cover border border-[#2a2e3b] absolute top-0 left-0"
      />
      <div className="w-5 h-5 rounded-full bg-blue-500/30 border border-blue-500/40 absolute bottom-0 right-0 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-3 h-3 fill-blue-300">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
        </svg>
      </div>
    </div>
  )
}

/* ─── Sinais mock data ─── */
const SINAIS_ATIVOS = [
  { assetId: 'bch-otc',      name: 'Bitcoin Cash (OTC)',       code1: 'crypto:bch', code2: 'us', dir: 'down', dur: '15:00', time: '20.05 21:07' },
  { assetId: 'dot-otc',      name: 'Polkadot (OTC)',           code1: 'crypto:dot', code2: 'us', dir: 'down', dur: '15:00', time: '20.05 21:07' },
  { assetId: 'usd-ngn-otc',  name: 'USD/NGN (OTC)',            code1: 'us', code2: 'ng',         dir: 'up',   dur: '15:00', time: '20.05 21:06' },
  { assetId: 'silver',       name: 'Silver (OTC)',             code1: 'us', code2: 'us',         dir: 'up',   dur: '05:00', time: '20.05 21:06' },
  { assetId: 'aud-usd',      name: 'AUD/USD (OTC)',            code1: 'au', code2: 'us',         dir: 'up',   dur: '01:00:00', time: '20.05 21:07' },
  { assetId: 'link-otc',     name: 'Chainlink (OTC)',          code1: 'crypto:link', code2: 'us', dir: 'up',  dur: '30:00', time: '20.05 21:07' },
  { assetId: 'usd-jpy',      name: 'USD/JPY (OTC)',            code1: 'us', code2: 'jp',         dir: 'down', dur: '04:00:00', time: '20.05 21:07' },
  { assetId: 'eur-chf-otc',  name: 'EUR/CHF (OTC)',            code1: 'eu', code2: 'ch',         dir: 'down', dur: '10:00', time: '20.05 21:07' },
  { assetId: 'usd-mxn-otc',  name: 'USD/MXN (OTC)',           code1: 'us', code2: 'mx',         dir: 'up',   dur: '05:00', time: '20.05 21:07' },
  { assetId: 'usd-brl-otc',  name: 'USD/BRL (OTC)',           code1: 'us', code2: 'br',         dir: 'up',   dur: '10:00', time: '20.05 21:07' },
]

const SINAIS_PASSADOS = [
  { assetId: 'trump-otc',    name: 'Trump (OTC)',   code1: 'us', code2: 'us',         dir: 'down', dur: '05:00', time: '20.05 21:05' },
  { assetId: 'gbp-chf-otc',  name: 'GBP/CHF (OTC)',code1: 'gb', code2: 'ch',         dir: 'down', dur: '15:00', time: '20.05 21:04' },
  { assetId: 'aud-nzd-otc',  name: 'AUD/NZD (OTC)',code1: 'au', code2: 'nz',         dir: 'down', dur: '15:00', time: '20.05 21:03' },
  { assetId: 'aud-usd',      name: 'AUD/USD',       code1: 'au', code2: 'us',         dir: 'up',   dur: '10:00', time: '20.05 21:02' },
  { assetId: 'gbp-usd',      name: 'GBP/USD',       code1: 'gb', code2: 'us',         dir: 'down', dur: '05:00', time: '20.05 21:01' },
]

function getImgSrc(code: string) {
  if (code.startsWith('crypto:')) {
    return `https://assets.coincap.io/assets/icons/${code.replace('crypto:', '')}@2x.png`
  }
  return `https://flagcdn.com/w40/${code}.png`
}

function MiniFlag({ code1, code2 }: { code1: string; code2: string }) {
  return (
    <div className="relative w-7 h-5 flex-shrink-0">
      <img src={getImgSrc(code1)} className="w-5 h-5 rounded-full object-cover border border-[#2a2e3b] absolute left-0 top-0 z-10" />
      <img src={getImgSrc(code2)} className="w-5 h-5 rounded-full object-cover border border-[#2a2e3b] absolute left-2.5 top-0 z-0" />
    </div>
  )
}

function DirCircle({ dir }: { dir: string }) {
  return (
    <div className={cn(
      'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
      dir === 'up' ? 'bg-green-500' : 'bg-red-500'
    )}>
      {dir === 'up' ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 8V2M5 2L2 5M5 2L8 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 2V8M5 8L2 5M5 8L8 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  )
}

function SinaisView({ onBack, onSelectAsset }: { onBack: () => void; onSelectAsset?: (asset: Asset) => void }) {
  function handleSignalClick(assetId: string) {
    const asset = ASSETS.find(a => a.id === assetId)
    if (asset && onSelectAsset) onSelectAsset(asset)
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2e3b] flex-shrink-0">
        <button onClick={onBack} className="text-[#8b8f9a] hover:text-white transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-bold text-white">Sinais de negociação</h2>
          <button className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors font-semibold">
            O QUE É ISSO?
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Active signals */}
        <div className="flex flex-col">
          {SINAIS_ATIVOS.map((s, i) => (
            <button
              key={i}
              onClick={() => handleSignalClick(s.assetId)}
              className="flex items-center gap-2 px-4 py-2.5 border-b border-[#2a2e3b]/40 hover:bg-white/[0.04] transition-colors w-full text-left cursor-pointer"
            >
              <MiniFlag code1={s.code1} code2={s.code2} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white truncate leading-tight">{s.name}</div>
                <div className="text-[10px] text-[#8b8f9a] mt-0.5">
                  Duração: <span className="text-white">{s.dur}</span>
                  <span className="ml-1.5 text-[#8b8f9a]">{s.time}</span>
                </div>
              </div>
              <DirCircle dir={s.dir} />
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="py-2 text-center">
          <span className="text-[9px] font-bold text-[#8b8f9a] tracking-widest">SINAIS PASSADOS</span>
        </div>

        {/* Past signals — not clickable, just history */}
        <div className="flex flex-col gap-2 px-3 pb-3">
          {SINAIS_PASSADOS.map((s, i) => (
            <div key={i} className="flex items-center gap-2 bg-[#252a3a] rounded-xl px-3 py-2.5 opacity-60">
              <MiniFlag code1={s.code1} code2={s.code2} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white truncate leading-tight">{s.name}</div>
                <div className="text-[10px] mt-0.5">
                  <span className="text-[#8b8f9a]">Duração: {s.dur}</span>
                  <span className="ml-1.5 text-blue-400 font-semibold">{s.time}</span>
                </div>
              </div>
              <DirCircle dir={s.dir} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function TopView({ onBack }: { onBack: () => void }) {
  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-[#2a2e3b] flex-shrink-0">
        <button onClick={onBack} className="text-[#8b8f9a] hover:text-white transition-colors mt-0.5">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 px-2">
          <h2 className="text-sm font-bold text-white leading-tight">Tabela de classificação</h2>
          <p className="text-[10px] text-[#8b8f9a] mt-0.5">do dia</p>
        </div>
        <button onClick={onBack} className="w-6 h-6 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* My position */}
      <div className="px-4 py-3 border-b border-[#2a2e3b] flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
          <span className="text-xs font-semibold text-white">Canga (REI...</span>
          <span className="text-xs font-semibold text-green-400 ml-auto">$21,917.80</span>
        </div>
        <p className="text-[10px] text-blue-400 font-semibold mb-1.5">Sua posição: 2</p>
        <button className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
          <HelpCircle size={11} />
          Como funciona essa classificação?
        </button>
      </div>

      {/* Leaderboard list */}
      <div className="flex-1 overflow-y-auto">
        {LEADERBOARD.map((entry) => {
          const medal = MEDAL_COLORS[entry.pos]
          return (
            <div
              key={entry.pos}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 border-b border-[#2a2e3b]/50 hover:bg-white/[0.02] transition-colors',
                entry.isMe && 'bg-blue-500/5'
              )}
            >
              {/* Position */}
              {medal ? (
                <div className={cn('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold', medal.bg, medal.text)}>
                  {entry.pos}
                </div>
              ) : (
                <span className="w-5 text-center text-[10px] text-[#8b8f9a] font-medium flex-shrink-0">{entry.pos}</span>
              )}

              {/* Avatar */}
              <Avatar flag={entry.flag} />

              {/* Name */}
              <span className={cn('text-xs flex-1 truncate', entry.isMe ? 'text-white font-semibold' : 'text-[#ccc]')}>
                {entry.name}
              </span>

              {/* Amount */}
              <span className="text-xs font-semibold text-green-400 flex-shrink-0">{entry.amount}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

const MENU_ITEMS = [
  {
    key: 'analise' as MaisView,
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-blue-400">
        <path d="M9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4zm2.5 2.25H4.5V5h15v14.25zM19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
      </svg>
    ),
    label: 'Análise',
    bg: 'bg-blue-500/15 border-blue-500/20',
  },
  {
    key: 'top' as MaisView,
    icon: <Trophy size={20} className="text-yellow-400" />,
    label: 'TOP',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
  },
  {
    key: 'sinais' as MaisView,
    icon: <Radio size={20} className="text-green-400" />,
    label: 'Sinais',
    bg: 'bg-green-500/10 border-green-500/20',
  },
]

export function MaisPanel({ onClose, onSelectAsset }: MaisPanelProps) {
  const [view, setView] = useState<MaisView>('menu')

  return (
    <div className="flex flex-col bg-[#1a1e2e] border-r border-[#2a2e3b] flex-shrink-0" style={{ width: 240 }}>

      {view === 'top' ? (
        <TopView onBack={() => setView('menu')} />
      ) : view === 'sinais' ? (
        <SinaisView onBack={() => setView('menu')} onSelectAsset={(asset) => { onSelectAsset?.(asset); onClose() }} />
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
            <h2 className="text-base font-bold text-white">Mais</h2>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Menu items */}
          <div className="flex flex-col gap-1 p-3">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors text-left group"
              >
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${item.bg}`}>
                  {item.icon}
                </div>
                <span className="text-sm font-semibold text-white flex-1">{item.label}</span>
                <ChevronRight size={16} className="text-[#8b8f9a] group-hover:text-white transition-colors" />
              </button>
            ))}
          </div>
        </>
      )}

    </div>
  )
}
