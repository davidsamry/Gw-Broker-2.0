'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  FileSpreadsheet, Plus, RefreshCw, Trash2, Pencil, Check, X as XIcon,
  ArrowUp, ArrowDown,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Signal {
  id:          string
  assetId:     string
  scheduledAt: string  // ISO from API
  timeframe:   number
  direction:   'CALL' | 'PUT'
  enabled:     boolean
}

interface Settings {
  enabled: boolean
}

interface OtcAssetOpt {
  id:     string
  symbol: string
  name:   string
}

const TIMEFRAMES = [
  { sec: 60,   label: 'M1' },
  { sec: 300,  label: 'M5' },
  { sec: 900,  label: 'M15' },
]

export default function CadastroOtcPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [settings, setSettings] = useState<Settings>({ enabled: false })
  const [assets, setAssets] = useState<OtcAssetOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState(false)

  // Form
  const [assetId, setAssetId]     = useState('')
  const [datetime, setDatetime]   = useState('')  // "yyyy-MM-ddTHH:mm" local
  const [timeframe, setTimeframe] = useState(60)
  const [direction, setDirection] = useState<'CALL' | 'PUT'>('CALL')
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    // Independent fetches — partial success is OK. If signals fails (e.g.,
    // migration not applied yet) the page still shows the master toggle
    // + asset list + form, so the admin can diagnose / retry without
    // the whole page being broken.
    const [sigRes, setRes, otcRes] = await Promise.allSettled([
      api.get<{ signals: Signal[] }>('/admin/manipulation/signals'),
      api.get<Settings>('/admin/manipulation/settings'),
      api.get<{ assets: any[] }>('/admin/otc/assets'),
    ])

    const errs: string[] = []
    if (sigRes.status === 'fulfilled') {
      setSignals(sigRes.value.data.signals)
    } else {
      const detail = (sigRes.reason as any)?.response?.data?.detail
                  ?? (sigRes.reason as any)?.response?.data?.error
                  ?? (sigRes.reason as any)?.message
      if (detail && /relation .* does not exist|does not exist/i.test(detail)) {
        errs.push('Migration pendente: tabela otc_manipulation_signals não existe. Aplique a migration no Supabase (ou reimplante a API).')
      } else {
        errs.push(`Sinais: ${detail ?? 'falha'}`)
      }
    }
    if (setRes.status === 'fulfilled') {
      setSettings(setRes.value.data)
    } else {
      const detail = (setRes.reason as any)?.response?.data?.detail
                  ?? (setRes.reason as any)?.message
      if (!errs.some((e) => e.startsWith('Migration'))) {
        errs.push(`Configuração: ${detail ?? 'falha'}`)
      }
    }
    if (otcRes.status === 'fulfilled') {
      setAssets((otcRes.value.data.assets ?? []).map((a: any) => ({
        id: a.id, symbol: a.symbol, name: a.name,
      })))
    } else {
      errs.push(`Lista de ativos: ${(otcRes.reason as any)?.message ?? 'falha'}`)
    }

    if (errs.length > 0) setError(errs.join(' · '))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleMaster() {
    setBusy(true)
    try {
      const { data } = await api.patch<Settings>('/admin/manipulation/settings', {
        enabled: !settings.enabled,
      })
      setSettings(data)
    } catch {
      alert('Erro ao atualizar configuração.')
    } finally {
      setBusy(false)
    }
  }

  async function submitSignal(e: React.FormEvent) {
    e.preventDefault()
    if (!assetId || !datetime) return
    setBusy(true)
    try {
      const body = {
        assetId,
        scheduledAt: new Date(datetime).toISOString(),
        timeframe,
        direction,
      }
      if (editingId) {
        await api.patch(`/admin/manipulation/signals/${editingId}`, body)
      } else {
        await api.post('/admin/manipulation/signals', body)
      }
      // Reset form
      setAssetId(''); setDatetime(''); setTimeframe(60); setDirection('CALL'); setEditingId(null)
      await load()
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Erro ao salvar sinal.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleSignal(s: Signal) {
    try {
      await api.patch(`/admin/manipulation/signals/${s.id}`, { enabled: !s.enabled })
      setSignals((prev) => prev.map((x) => x.id === s.id ? { ...x, enabled: !x.enabled } : x))
    } catch {
      alert('Erro ao alternar.')
    }
  }

  async function deleteSignal(s: Signal) {
    if (!confirm(`Excluir o sinal ${s.assetId} ${formatDateTime(s.scheduledAt)}?`)) return
    try {
      await api.delete(`/admin/manipulation/signals/${s.id}`)
      setSignals((prev) => prev.filter((x) => x.id !== s.id))
    } catch {
      alert('Erro ao excluir.')
    }
  }

  function startEdit(s: Signal) {
    setEditingId(s.id)
    setAssetId(s.assetId)
    setDatetime(toLocalDatetimeInput(s.scheduledAt))
    setTimeframe(s.timeframe)
    setDirection(s.direction)
  }

  function cancelEdit() {
    setEditingId(null)
    setAssetId(''); setDatetime(''); setTimeframe(60); setDirection('CALL')
  }

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-emerald-400" />
            Cadastro OTC
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">
            Programe a direção de fechamento das velas OTC. Quando ativo,
            o motor empurra o preço nos últimos segundos do slot para
            que a vela feche na direção configurada.
          </p>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#13161f] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Master toggle */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-4 mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white">Motor de Manipulação OTC</h3>
          <p className="text-xs text-[#8b8f9a] mt-1 leading-relaxed">
            Quando ativado, o sistema aplica os sinais cadastrados nos
            slots correspondentes. Quando desligado, todos os sinais
            ficam inativos (kill switch).
          </p>
        </div>
        <button
          onClick={toggleMaster}
          disabled={busy}
          className={cn(
            'w-12 h-6 rounded-full relative transition-colors flex-shrink-0 disabled:opacity-50',
            settings.enabled ? 'bg-emerald-500' : 'bg-[#2a2e3b]',
          )}
        >
          <span className={cn(
            'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform',
            settings.enabled ? 'translate-x-[26px]' : 'translate-x-0.5',
          )} />
        </button>
      </div>

      {/* New signal form */}
      <form
        onSubmit={submitSignal}
        className="bg-[#13161f] border border-[#1f232e] rounded-xl p-4 mb-5"
      >
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
          <Plus size={14} className="text-emerald-400" />
          {editingId ? 'Editar Sinal' : 'Novo Sinal OTC'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_180px_auto] gap-3">
          <Field label="Ativo OTC">
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              required
              className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 text-xs text-white outline-none focus:border-emerald-500/60"
            >
              <option value="">Selecione o ativo…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.symbol} — {a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Data/Hora (horário local)">
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              required
              className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 text-xs text-white outline-none focus:border-emerald-500/60"
            />
          </Field>
          <Field label="Timeframe">
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(Number(e.target.value))}
              className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 text-xs text-white outline-none focus:border-emerald-500/60"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf.sec} value={tf.sec}>{tf.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Direção">
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'CALL' | 'PUT')}
              className={cn(
                'w-full h-9 bg-[#1a1e2a] border rounded-lg px-3 text-xs font-bold outline-none focus:border-emerald-500/60',
                direction === 'CALL' ? 'border-emerald-500/40 text-emerald-400' : 'border-red-500/40 text-red-400',
              )}
            >
              <option value="CALL">CALL (Alta)</option>
              <option value="PUT">PUT (Baixa)</option>
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={busy || !assetId || !datetime}
              className="h-9 px-5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-black transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Plus size={13} />
              {editingId ? 'Salvar' : 'Adicionar'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="h-9 px-3 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Signals list */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1f232e] flex items-center gap-2 text-xs font-semibold text-white">
          Sinais Cadastrados ({signals.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[800px]">
            <thead>
              <tr className="border-b border-[#1f232e] text-[10px] text-[#8b8f9a] font-bold uppercase tracking-wide">
                <th className="text-left  px-4 py-3">Ativo</th>
                <th className="text-left  px-4 py-3">Horário</th>
                <th className="text-left  px-4 py-3">Timeframe</th>
                <th className="text-left  px-4 py-3">Direção</th>
                <th className="text-left  px-4 py-3">Ativo</th>
                <th className="text-right px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-10 text-center text-[#8b8f9a]">Carregando…</td></tr>
              ) : signals.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-[#8b8f9a]">Nenhum sinal cadastrado ainda.</td></tr>
              ) : signals.map((s) => (
                <tr key={s.id} className="border-b border-[#1f232e]/50 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-semibold text-white">{s.assetId.toUpperCase()}</td>
                  <td className="px-4 py-3 text-[#8b8f9a] font-mono">{formatDateTime(s.scheduledAt)}</td>
                  <td className="px-4 py-3 text-white">{tfLabel(s.timeframe)}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border',
                      s.direction === 'CALL'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                        : 'bg-red-500/15 text-red-400 border-red-500/40',
                    )}>
                      {s.direction === 'CALL' ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                      {s.direction}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleSignal(s)}
                      className={cn(
                        'w-10 h-5 rounded-full relative transition-colors',
                        s.enabled ? 'bg-emerald-500' : 'bg-[#2a2e3b]',
                      )}
                    >
                      <span className={cn(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        s.enabled ? 'translate-x-5' : 'translate-x-0.5',
                      )} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <IconBtn title="Editar" onClick={() => startEdit(s)}>
                        <Pencil size={12} />
                      </IconBtn>
                      <IconBtn title="Excluir" tone="red" onClick={() => deleteSignal(s)}>
                        <Trash2 size={12} />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-[#8b8f9a] mb-1.5 block uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function IconBtn({ children, onClick, title, tone = 'gray' }: {
  children: React.ReactNode
  onClick:  () => void
  title:    string
  tone?:    'gray' | 'red'
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded border transition-colors',
        tone === 'red'
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'border-[#1f232e] text-[#8b8f9a] hover:text-white hover:bg-white/5',
      )}
    >
      {children}
    </button>
  )
}

function tfLabel(sec: number): string {
  if (sec === 60)   return 'M1'
  if (sec === 300)  return 'M5'
  if (sec === 900)  return 'M15'
  return `${sec}s`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}`
}

function toLocalDatetimeInput(iso: string): string {
  // <input type="datetime-local"> expects "yyyy-MM-ddTHH:mm" in LOCAL time.
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Keep these icons imported for potential future use (e.g., row status icons).
void Check; void XIcon
