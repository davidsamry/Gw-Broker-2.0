'use client'

// Admin: Platform Settings (broker-wide limits + toggles).
// Mirrors the screenshot layout: 5 cards in a 2-column grid, single
// "Salvar Configurações" CTA at the top right. Dirty-state tracking
// keeps the button disabled until something changes.

import { useCallback, useEffect, useState } from 'react'
import {
  Settings, Save, RefreshCw, Check, AlertCircle, Loader2,
  Banknote, TrendingUp, BarChart2, Timer, Copy, Shield, ShieldCheck,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface PlatformSettings {
  withdrawalFeePct:       number
  withdrawalMin:          number
  withdrawalMax:          number
  depositMin:             number
  depositMax:             number
  depositRollover:        number
  operationMin:           number
  operationMax:           number
  operationMinIntervalMs: number
  copyTradeEnabled:       boolean
  safeModeEnabled:        boolean
}

interface Response { settings: PlatformSettings }

export default function AdminConfiguracoesPage() {
  const [server,  setServer]  = useState<PlatformSettings | null>(null)
  const [form,    setForm]    = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [flash,   setFlash]   = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<Response>('/admin/settings')
      setServer(data.settings)
      setForm(data.settings)
    } catch {
      setFlash({ tone: 'err', text: 'Falha ao carregar.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // "Has changes" diff so the Salvar button is disabled until something
  // genuinely changed — avoids accidental no-op writes.
  const dirty = !!(server && form && Object.keys(form).some(
    (k) => server[k as keyof PlatformSettings] !== form[k as keyof PlatformSettings]
  ))

  async function save() {
    if (!form) return
    setSaving(true); setFlash(null)
    try {
      const { data } = await api.patch<Response>('/admin/settings', form)
      setServer(data.settings)
      setForm(data.settings)
      setFlash({ tone: 'ok', text: 'Configurações salvas.' })
      setTimeout(() => setFlash(null), 4000)
    } catch (err: any) {
      const msg = err?.response?.data?.details?.formErrors?.[0]
                ?? err?.response?.data?.error
                ?? 'Erro ao salvar.'
      setFlash({ tone: 'err', text: msg })
    } finally {
      setSaving(false)
    }
  }

  function patch<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <Settings size={20} className="text-blue-400" />
            Configurações de Transações
          </h1>
          <p className="text-xs md:text-sm text-[#8b8f9a] mt-1">
            Configure limites e taxas de transações
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-sm text-white hover:border-blue-500/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            Atualizar
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar Configurações
          </button>
        </div>
      </div>

      {flash && (
        <div className={cn(
          'mb-4 px-4 py-3 rounded-lg border text-sm flex items-center gap-2',
          flash.tone === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400',
        )}>
          {flash.tone === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}{flash.text}
        </div>
      )}

      {loading && !form ? (
        <div className="text-center py-16 text-[#8b8f9a] text-sm">Carregando…</div>
      ) : !form ? null : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Saque */}
          <Card title="Configurações de Saque" icon={<Banknote size={14} className="text-emerald-400" />} desc="Defina taxas e limites para saques">
            <Number  label="Taxa de Saque (%)"   value={form.withdrawalFeePct} onChange={(v) => patch('withdrawalFeePct', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Number label="Mínimo de Saque (R$)" value={form.withdrawalMin} onChange={(v) => patch('withdrawalMin', v)} />
              <Number label="Máximo de Saque (R$)" value={form.withdrawalMax} onChange={(v) => patch('withdrawalMax', v)} />
            </div>
          </Card>

          {/* Depósito */}
          <Card title="Configurações de Depósito" icon={<TrendingUp size={14} className="text-emerald-400" />} desc="Defina limites e rollover para depósitos">
            <div className="grid grid-cols-2 gap-3">
              <Number label="Mínimo de Depósito (R$)" value={form.depositMin} onChange={(v) => patch('depositMin', v)} />
              <Number label="Máximo de Depósito (R$)" value={form.depositMax} onChange={(v) => patch('depositMax', v)} />
            </div>
            <Number
              label="Rollover de Depósito (sem bônus)"
              value={form.depositRollover}
              onChange={(v) => patch('depositRollover', v)}
              suffix="x"
              hint="Multiplicador do valor depositado para liberar saque"
            />
          </Card>

          {/* Operações */}
          <Card title="Configurações de Operações" icon={<BarChart2 size={14} className="text-emerald-400" />} desc="Defina limites para operações de trading">
            <div className="grid grid-cols-2 gap-3">
              <Number label="Valor Mínimo (R$)" value={form.operationMin} onChange={(v) => patch('operationMin', v)} />
              <Number label="Valor Máximo (R$)" value={form.operationMax} onChange={(v) => patch('operationMax', v)} />
            </div>
          </Card>

          {/* Limite de Operações */}
          <Card title="Limite de Operações" icon={<Timer size={14} className="text-emerald-400" />} desc="Configure o intervalo mínimo entre operações">
            <Number
              label="Intervalo Mínimo (ms)"
              value={form.operationMinIntervalMs}
              onChange={(v) => patch('operationMinIntervalMs', Math.round(v))}
              hint="Tempo mínimo entre operações em milissegundos (1000ms = 1 segundo)"
              integer
            />
          </Card>

          {/* Copy Trade — full row */}
          <div className="md:col-span-2">
            <Card title="Copy Trade" icon={<Copy size={14} className="text-purple-400" />} desc="Habilite ou desabilite o recurso de copy trade">
              <Toggle
                label="Habilitar Copy Trade"
                hint="Permite que usuários copiem operações de traders"
                value={form.copyTradeEnabled}
                onChange={(v) => patch('copyTradeEnabled', v)}
              />
            </Card>
          </div>

          {/* Modo Seguro (Anti-DevTools) — full row, status banner + toggle */}
          <div className="md:col-span-2">
            <SafeModeCard
              enabled={form.safeModeEnabled}
              onChange={(v) => patch('safeModeEnabled', v)}
            />
          </div>

        </div>
      )}
    </div>
  )
}

// Dedicated Modo Seguro card — matches the mocked design (header with
// shield, green "Proteção Ativa" banner when on, feature bullets at the
// bottom). The /admin area is exempt from the protection by design so
// admins can debug the platform without locking themselves out.
function SafeModeCard({ enabled, onChange }: {
  enabled:  boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="rounded-xl bg-[#1a1f2e] border border-[#2a2e3b] p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Shield size={20} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-bold text-white">Modo Seguro (Anti-DevTools)</h2>
          <p className="text-xs text-[#8b8f9a] mt-1 leading-relaxed">
            Bloqueia o acesso ao DevTools do navegador. Quando ativado, a aba será
            fechada automaticamente se o usuário tentar abrir as ferramentas de
            desenvolvedor.
          </p>
        </div>
      </div>

      {enabled && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 flex items-start gap-3">
          <ShieldCheck size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-emerald-400">Proteção Ativa</div>
            <div className="text-xs text-[#9aa3b6] mt-0.5">
              DevTools bloqueado. A aba será fechada automaticamente se detectado.
            </div>
          </div>
        </div>
      )}

      <Toggle
        label="Habilitar Modo Seguro"
        hint="Bloqueia DevTools e fecha a aba ao detectar"
        value={enabled}
        onChange={onChange}
      />

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-3">
        <div className="text-xs font-bold text-white mb-1.5">Funcionalidades do Modo Seguro:</div>
        <ul className="text-[11px] text-[#9aa3b6] space-y-1 leading-relaxed">
          <li>• Detecta abertura do DevTools (F12, Ctrl+Shift+I, etc.)</li>
          <li>• Fecha a aba automaticamente quando DevTools é detectado</li>
          <li>• Bloqueia menu de contexto (botão direito)</li>
          <li>• Limpa o console periodicamente</li>
        </ul>
        <div className="text-[10px] text-[#5d6275] mt-2 italic">
          O painel administrativo (/admin/*) é exento — você consegue inspecionar normalmente.
        </div>
      </div>
    </div>
  )
}

// ── Building blocks ──────────────────────────────────────────────────────
function Card({ title, desc, icon, children }: {
  title: string; desc: string; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-[#1a1f2e] border border-[#2a2e3b] p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-bold text-white flex items-center gap-1.5">{icon}{title}</h2>
        <p className="text-xs text-[#8b8f9a] mt-0.5">{desc}</p>
      </div>
      {children}
    </div>
  )
}

function Number({ label, value, onChange, suffix, hint, integer }: {
  label:    string
  value:    number
  onChange: (v: number) => void
  suffix?:  string
  hint?:    string
  integer?: boolean
}) {
  // Local string state so the user can clear the field and re-type
  // without the number normaliser swallowing intermediate values.
  const [local, setLocal] = useState(value.toString())
  useEffect(() => { setLocal(value.toString()) }, [value])
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-[#7c8195] font-semibold mb-1.5">{label}</label>
      <div className="relative">
        <input
          inputMode={integer ? 'numeric' : 'decimal'}
          value={local}
          onChange={(e) => {
            setLocal(e.target.value)
            const n = parseFloat(e.target.value.replace(',', '.'))
            if (!isNaN(n)) onChange(integer ? Math.round(n) : n)
          }}
          className="w-full bg-[#222637] border border-[#2a2e3b] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors"
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8b8f9a] text-sm">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-[#7c8195] mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ label, hint, value, onChange }: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-white">{label}</div>
        {hint && <div className="text-xs text-[#8b8f9a] mt-0.5">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          'relative inline-block w-11 h-6 rounded-full transition-colors flex-shrink-0',
          value ? 'bg-emerald-500' : 'bg-[#2a2e3b]',
        )}
      >
        <div className={cn(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
          value && 'translate-x-5',
        )} />
      </button>
    </div>
  )
}
