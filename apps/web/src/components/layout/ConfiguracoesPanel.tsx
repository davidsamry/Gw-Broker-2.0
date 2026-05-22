'use client'

import { useState } from 'react'
import { X, Globe, Clock, ChevronDown, Check, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

type Theme = 'diurno' | 'crepusculo' | 'noite'

export interface TradeSettings {
  autoScroll: boolean
  performanceMode: boolean
  shortLabels: boolean
}

interface ConfiguracoesPanelProps {
  onClose: () => void
  theme?: Theme
  onThemeChange?: (t: Theme) => void
  settings?: TradeSettings
  onSettingsChange?: (s: TradeSettings) => void
}

const THEMES: { key: Theme; emoji: string; label: string }[] = [
  { key: 'diurno',    emoji: '☀️',  label: 'Modo diurno'  },
  { key: 'crepusculo',emoji: '🌅',  label: 'Crepúsculo'   },
  { key: 'noite',     emoji: '🌙',  label: 'Noite inteira' },
]

const UP_COLORS   = ['#22c55e', '#16a34a', '#06b6d4', '#67e8f9', '#e5e7eb']
const DOWN_COLORS = ['#ef4444', '#b91c1c', '#f97316', '#a855f7', '#111827']

function SectionLabel({ label }: { label: string }) {
  return <p className="text-[10px] font-bold text-[#8b8f9a] tracking-widest mb-3">{label}</p>
}

function FloatingDropdown({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="relative border border-[#2a2e3b] rounded-lg px-3 pt-5 pb-2 bg-[#1a1e2e] mb-3 cursor-pointer hover:border-blue-500/40 transition-colors">
      <span className="absolute top-1.5 left-3 text-[10px] text-[#8b8f9a] font-medium">{label}</span>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm text-white">{value}</span>
        </div>
        <ChevronDown size={13} className="text-[#8b8f9a]" />
      </div>
    </div>
  )
}

function Toggle({ on }: { on: boolean }) {
  return (
    <div className={cn('relative w-9 h-5 rounded-full transition-colors flex-shrink-0', on ? 'bg-blue-500' : 'bg-[#3a3f50]')}>
      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-4' : 'translate-x-0.5')} />
    </div>
  )
}

function CheckItem({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-start gap-3 text-left w-full mb-4 group">
      <div className={cn(
        'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border transition-colors',
        checked ? 'bg-blue-500 border-blue-500' : 'border-[#3a3f50] bg-transparent'
      )}>
        {checked && <Check size={10} className="text-white" />}
      </div>
      <div>
        <div className="text-sm font-semibold text-white group-hover:text-white/80 transition-colors">{label}</div>
        <div className="text-[10px] text-[#8b8f9a] mt-0.5 leading-relaxed">{sub}</div>
      </div>
    </button>
  )
}

function ColorPicker({ label, colors, circleColor }: { label: string; colors: string[]; circleColor: string }) {
  const [selected, setSelected] = useState(0)
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: circleColor }} />
        <span className="text-sm font-semibold text-white">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {colors.map((c, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-transform hover:scale-105 border-2"
            style={{ background: c, borderColor: selected === i ? 'white' : 'transparent' }}
          >
            {selected === i && <Check size={14} className="text-white drop-shadow" />}
          </button>
        ))}
      </div>
    </div>
  )
}

const DEFAULT_SETTINGS: TradeSettings = {
  autoScroll: true,
  performanceMode: true,
  shortLabels: true,
}

export function ConfiguracoesPanel({ onClose, theme: themeProp = 'noite', onThemeChange, settings = DEFAULT_SETTINGS, onSettingsChange }: ConfiguracoesPanelProps) {
  const [theme, setThemeLocal] = useState<Theme>(themeProp)

  function setTheme(t: Theme) {
    setThemeLocal(t)
    onThemeChange?.(t)
  }

  function setSetting<K extends keyof TradeSettings>(key: K, value: TradeSettings[K]) {
    onSettingsChange?.({ ...settings, [key]: value })
  }

  const [opacity, setOpacity] = useState(8)

  return (
    <div
      className="flex flex-col bg-[#1a1e2e] border-r border-[#2a2e3b] flex-shrink-0 z-40"
      style={{ width: 280 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b] flex-shrink-0">
        <h2 className="text-base font-bold text-white">Configurações</h2>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">

        {/* Idioma + Fuso */}
        <FloatingDropdown label="Idioma"      value="Português"   icon={<Globe size={14} className="text-[#8b8f9a]" />} />
        <FloatingDropdown label="Fuso horário" value="(UTC-03:00)" icon={<Clock size={14} className="text-[#8b8f9a]" />} />

        {/* Modelo */}
        <SectionLabel label="MODELO" />
        <div className="flex flex-col gap-2 mb-5">
          {THEMES.map((t) => {
            const isActive = theme === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                className={cn(
                  'flex items-center justify-between px-4 py-3 rounded-xl border transition-colors',
                  isActive
                    ? 'bg-white border-white'
                    : 'bg-[#252a3a] border-[#2a2e3b] hover:border-blue-500/30'
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{t.emoji}</span>
                  <span className={cn('text-sm font-semibold', isActive ? 'text-[#151822]' : 'text-white')}>
                    {t.label}
                  </span>
                </div>
                <Toggle on={isActive} />
              </button>
            )
          })}
        </div>

        {/* Plataforma */}
        <SectionLabel label="PLATAFORMA" />

        {/* Opacidade */}
        <div className="border border-[#2a2e3b] rounded-lg overflow-hidden mb-4">
          <div className="px-3 py-1.5 border-b border-[#2a2e3b]">
            <span className="text-[10px] text-[#8b8f9a] font-medium">Opacidade da grade</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <button
              onClick={() => setOpacity(Math.max(0, opacity - 1))}
              className="w-7 h-7 flex items-center justify-center rounded text-white bg-[#2a2e3b] hover:bg-[#3a3f50] transition-colors text-sm font-bold"
            >−</button>
            <span className="text-sm font-bold text-white">{opacity}</span>
            <button
              onClick={() => setOpacity(Math.min(20, opacity + 1))}
              className="w-7 h-7 flex items-center justify-center rounded text-white bg-[#2a2e3b] hover:bg-[#3a3f50] transition-colors text-sm font-bold"
            >+</button>
          </div>
        </div>

        <CheckItem label="Rolagem automática"      sub="Rolagem gráfica automática"                        checked={settings.autoScroll}      onChange={(v) => setSetting('autoScroll', v)} />
        <CheckItem label="Modo de desempenho"      sub="Use renderização otimizada para gráficos e velas"  checked={settings.performanceMode} onChange={(v) => setSetting('performanceMode', v)} />
        <CheckItem label="Rótulo de pedido curto"  sub="Use o modo de elemento de ordem curta"             checked={settings.shortLabels}     onChange={(v) => setSetting('shortLabels', v)} />

        {/* Cores do gráfico */}
        <SectionLabel label="CORES DO GRÁFICO" />
        <ColorPicker label="Tendência de alta"  colors={UP_COLORS}   circleColor="#22c55e" />
        <ColorPicker label="Tendência de baixa" colors={DOWN_COLORS} circleColor="#ef4444" />

        {/* Fundo */}
        <SectionLabel label="FUNDO" />
        <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Upload size={15} className="text-white" />
          </div>
          <div className="text-left">
            <div className="text-sm font-bold text-white">Escolher arquivo</div>
            <div className="text-[10px] text-blue-200">(Tamanho máximo — 2 MB)</div>
          </div>
        </button>

      </div>
    </div>
  )
}
