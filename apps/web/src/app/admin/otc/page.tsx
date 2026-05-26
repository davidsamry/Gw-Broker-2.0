'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Activity, Pause, Play, RotateCcw, RefreshCw, Pencil, X, Loader2, Check,
  TrendingUp, TrendingDown, Minus, AlertCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types — must match apps/api/src/admin/otc/service.ts ──────────────
type OtcRegime =
  | 'LATERAL'
  | 'TREND_UP_WEAK' | 'TREND_UP_STRONG'
  | 'TREND_DOWN_WEAK' | 'TREND_DOWN_STRONG'
  | 'HIGH_VOL' | 'LOW_VOL'
  | 'COMPRESSION' | 'EXPANSION'

interface OtcLiveState {
  id:               string
  price:            number
  smoothedPrice:    number
  regime:           OtcRegime
  regimeStartedAt:  number
  regimeDurationMs: number
  spread:           number
  buyPressure:      number
  sellPressure:     number
  volume:           number
  depth:            number
  speed:            number
  trendBias:        number
  enabled:          boolean
  paused:           boolean
  // Fase 9 freshness markers
  lastTickAt:       number | null
  lastCandleAt:     number | null
}

interface EngineStatus {
  running:           boolean
  bootedAt:          number | null
  uptimeMs:          number
  totalAssets:       number
  sseClients:        number
  snapshotUpdatedAt: string | null
  snapshotAgeMs:     number | null
  gapFills24h:       number
  recentGapFills:    Array<{ ts: string; assetId: string; tf: number; slotsFilled: number }>
}

interface OtcAdminAsset {
  id:               string
  symbol:           string
  name:             string
  category:         string
  enabled:          boolean
  paused:           boolean
  payout:           number
  seedPrice:        string
  volatilityBase:   number
  speedMultiplier:  number
  displayOrder:     number
  live:             OtcLiveState | null
  openOpsCount:     number
  openOpsAmount:    string
}

interface ListResponse  { assets: OtcAdminAsset[] }
interface AssetResponse { asset:  OtcAdminAsset }

const REGIME_LABEL: Record<OtcRegime, string> = {
  LATERAL:           'Lateral',
  TREND_UP_WEAK:     'Alta fraca',
  TREND_UP_STRONG:   'Alta forte',
  TREND_DOWN_WEAK:   'Baixa fraca',
  TREND_DOWN_STRONG: 'Baixa forte',
  HIGH_VOL:          'Alta vol.',
  LOW_VOL:           'Baixa vol.',
  COMPRESSION:       'Compressão',
  EXPANSION:         'Expansão',
}

const REGIME_CLASS: Record<OtcRegime, string> = {
  LATERAL:           'bg-[#1a1f2e] text-[#c3c6cf] border-[#2a2e3b]',
  TREND_UP_WEAK:     'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  TREND_UP_STRONG:   'bg-emerald-500/25 text-emerald-300 border-emerald-500/50',
  TREND_DOWN_WEAK:   'bg-red-500/15 text-red-400 border-red-500/30',
  TREND_DOWN_STRONG: 'bg-red-500/25 text-red-300 border-red-500/50',
  HIGH_VOL:          'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW_VOL:           'bg-blue-500/15 text-blue-400 border-blue-500/30',
  COMPRESSION:       'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  EXPANSION:         'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
}

// ── Page ──────────────────────────────────────────────────────────────
export default function AdminOtcPage() {
  const [assets, setAssets]   = useState<OtcAdminAsset[]>([])
  const [status, setStatus]   = useState<EngineStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [editing, setEditing] = useState<OtcAdminAsset | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [fullResetBusy, setFullResetBusy] = useState(false)
  const [fullResetMsg,  setFullResetMsg]  = useState('')

  // Full reload — fetches assets + engine status in parallel.
  // (Fase 9: status added to the same polling cadence as the cards.)
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const [assetsRes, statusRes] = await Promise.all([
        api.get<ListResponse>('/admin/otc/assets'),
        api.get<EngineStatus>('/admin/otc/engine-status').catch(() => null),
      ])
      setAssets(assetsRes.data.assets)
      if (statusRes) setStatus(statusRes.data)
    } catch {
      setError('Falha ao carregar ativos OTC.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial load + silent poll every 3s for live state. Polling pauses
  // while the edit modal is open so values don't shift under the form.
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (editing) return
    const id = setInterval(() => load(true), 3000)
    return () => clearInterval(id)
  }, [editing, load])

  async function callMutation(assetId: string, fn: () => Promise<AssetResponse>) {
    setBusyId(assetId); setError('')
    try {
      const { asset } = await fn()
      setAssets((prev) => prev.map((a) => (a.id === assetId ? asset : a)))
    } catch {
      setError('Falha ao executar ação.')
    } finally {
      setBusyId(null)
    }
  }

  const togglePause = (a: OtcAdminAsset) => callMutation(a.id, async () => {
    const path = a.paused ? 'resume' : 'pause'
    const { data } = await api.post<AssetResponse>(`/admin/otc/assets/${a.id}/${path}`)
    return data
  })

  const reset = (a: OtcAdminAsset) => callMutation(a.id, async () => {
    const { data } = await api.post<AssetResponse>(`/admin/otc/assets/${a.id}/reset`)
    return data
  })

  // Nuclear reset — wipes every asset's price history + in-memory state
  // back to seedPrice. Confirms before firing because it's destructive
  // (3000+ candles/asset gone) but past operations are preserved.
  const fullReset = async () => {
    if (!confirm('Resetar TODOS os ativos OTC?\n\nIsso apaga todo o histórico de candles/ticks e volta cada preço ao seed. Operações passadas são preservadas. Use quando o motor estiver com preços absurdos.')) return
    setFullResetBusy(true); setError(''); setFullResetMsg('')
    try {
      const { data } = await api.post<{
        ok: boolean
        inMemory: { assetsReset: number; buildersReset: number; cacheCleared: number; pendingDropped: number }
        db: { snapshotsDeleted: number; candlesDeleted: number; ticksDeleted: number; marketStateReset: number; liquidityStateReset: number }
      }>('/admin/otc/full-reset')
      setFullResetMsg(`Reset OK · ${data.inMemory.assetsReset} ativos · ${data.db.candlesDeleted.toLocaleString('pt-BR')} candles apagados · ${data.db.ticksDeleted.toLocaleString('pt-BR')} ticks apagados`)
      await load(true)
      // Clear success message after 10s.
      setTimeout(() => setFullResetMsg(''), 10_000)
    } catch {
      setError('Falha ao resetar o motor inteiro.')
    } finally {
      setFullResetBusy(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">OTC v2</h1>
          <p className="text-xs md:text-sm text-[#8b8f9a] mt-1">
            Motor de precificação server-side. Pause, resete e ajuste cada ativo em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fullReset}
            disabled={fullResetBusy || loading}
            title="Nuclear: limpa todo histórico e volta cada ativo ao seed price"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {fullResetBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Resetar Tudo
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-sm text-white hover:border-emerald-500/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {fullResetMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400 flex items-center gap-2">
          <Check size={14} />
          {fullResetMsg}
        </div>
      )}

      {/* Fase 9: engine status bar */}
      {status && <EngineStatusBar status={status} />}

      {/* Grid */}
      {loading && assets.length === 0 ? (
        <div className="text-center py-16 text-[#8b8f9a] text-sm">Carregando…</div>
      ) : assets.length === 0 ? (
        <div className="text-center py-16 text-[#8b8f9a] text-sm">Nenhum ativo OTC cadastrado.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {assets.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              busy={busyId === a.id}
              onEdit={() => setEditing(a)}
              onTogglePause={() => togglePause(a)}
              onReset={() => reset(a)}
            />
          ))}
        </div>
      )}

      {editing && (
        <EditAssetModal
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ── Asset card ────────────────────────────────────────────────────────
function AssetCard({
  asset, busy, onEdit, onTogglePause, onReset,
}: {
  asset:          OtcAdminAsset
  busy:           boolean
  onEdit:         () => void
  onTogglePause:  () => void
  onReset:        () => void
}) {
  const live      = asset.live
  const isOffline = !live
  const isPaused  = asset.paused
  const isDisabled= !asset.enabled

  const statusLabel =
    isOffline  ? 'Offline'  :
    isPaused   ? 'Pausado'  :
    isDisabled ? 'Desativado' :
                 'Rodando'

  const statusClass =
    isOffline  ? 'bg-[#1a1f2e] text-[#8b8f9a] border-[#2a2e3b]' :
    isPaused   ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
    isDisabled ? 'bg-[#1a1f2e] text-[#8b8f9a] border-[#2a2e3b]' :
                 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'

  const buyPct  = live ? Math.round(live.buyPressure  * 100) : 50
  const sellPct = live ? Math.round(live.sellPressure * 100) : 50

  return (
    <div className="bg-[#0f1117] border border-[#1f232e] rounded-xl p-4">
      {/* Top row: symbol + status */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-white">{asset.symbol}</span>
            <span className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border',
              statusClass,
            )}>
              {statusLabel}
            </span>
          </div>
          <div className="text-[11px] text-[#8b8f9a] mt-0.5 truncate">{asset.name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-[#8b8f9a]">Preço</div>
          <div className="text-lg font-bold text-white tabular-nums leading-tight">
            {live ? live.smoothedPrice.toFixed(5) : '—'}
          </div>
        </div>
      </div>

      {/* Regime + payout row */}
      <div className="flex items-center gap-2 mb-3">
        {live ? (
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border',
            REGIME_CLASS[live.regime],
          )}>
            <RegimeIcon regime={live.regime} />
            {REGIME_LABEL[live.regime]}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border bg-[#1a1f2e] text-[#8b8f9a] border-[#2a2e3b]">
            Sem estado
          </span>
        )}
        <span className="ml-auto text-[11px] text-[#8b8f9a]">
          Payout <span className="text-emerald-400 font-bold">{asset.payout}%</span>
        </span>
      </div>

      {/* Pressure bars */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] text-[#8b8f9a] mb-1">
          <span>Compra <span className="text-emerald-400 font-medium">{buyPct}%</span></span>
          <span>Venda <span className="text-red-400 font-medium">{sellPct}%</span></span>
        </div>
        <div className="h-1.5 bg-[#1a1f2e] rounded-full overflow-hidden flex">
          <div className="bg-emerald-500 h-full" style={{ width: `${buyPct}%` }} />
          <div className="bg-red-500    h-full" style={{ width: `${sellPct}%` }} />
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <Metric label="Volatil."   value={asset.volatilityBase.toFixed(5)} />
        <Metric label="Velocidade" value={`${asset.speedMultiplier}×`} />
        <Metric label="Trend"      value={live ? trendStr(live.trendBias) : '—'} />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <Metric label="Ops abertas" value={String(asset.openOpsCount)} />
        <Metric label="Risco"       value={`R$ ${Number(asset.openOpsAmount).toFixed(0)}`} />
        <Metric label="Spread"      value={live ? live.spread.toFixed(5) : '—'} />
      </div>

      {/* Fase 9: freshness row — tick + candle ages */}
      {live && (
        <div className="grid grid-cols-2 gap-2 mb-3 text-center">
          <Metric label="Último tick"   value={live.lastTickAt   ? agoStr(live.lastTickAt)   : '—'} />
          <Metric label="Última vela"   value={live.lastCandleAt ? agoStr(live.lastCandleAt) : '—'} />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onEdit}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-[12px] text-white hover:border-emerald-500/40 transition-colors disabled:opacity-50"
        >
          <Pencil size={12} /> Editar
        </button>
        <button
          onClick={onTogglePause}
          disabled={busy}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] transition-colors disabled:opacity-50',
            isPaused
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25'
              : 'bg-amber-500/15  border-amber-500/40  text-amber-400  hover:bg-amber-500/25',
          )}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : isPaused ? <Play size={12} /> : <Pause size={12} />}
          {isPaused ? 'Retomar' : 'Pausar'}
        </button>
        <button
          onClick={onReset}
          disabled={busy}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-[#c3c6cf] hover:border-blue-500/40 hover:text-blue-400 transition-colors disabled:opacity-50"
          title="Resetar para seed price"
        >
          <RotateCcw size={12} />
        </button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0d13] rounded-lg py-1.5 px-2 border border-[#1f232e]">
      <div className="text-[9px] uppercase tracking-wider text-[#6b7280]">{label}</div>
      <div className="text-[11px] font-bold text-white mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}

function RegimeIcon({ regime }: { regime: OtcRegime }) {
  if (regime.startsWith('TREND_UP'))   return <TrendingUp   size={10} />
  if (regime.startsWith('TREND_DOWN')) return <TrendingDown size={10} />
  if (regime === 'HIGH_VOL' || regime === 'EXPANSION') return <Activity size={10} />
  return <Minus size={10} />
}

function trendStr(bias: number): string {
  if (Math.abs(bias) < 0.05) return '0'
  return (bias > 0 ? '+' : '') + bias.toFixed(2)
}

// Fase 9 — "234ms ago" / "12s ago" / "3min ago" — never shows future
// or negative values (defensive against clock skew).
function agoStr(epochMs: number): string {
  const diff = Math.max(0, Date.now() - epochMs)
  if (diff < 1_000)        return `${diff}ms`
  if (diff < 60_000)       return `${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}min`
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

// Fase 9 — uptime "2h 14min" / "12min 04s" / "47s"
function uptimeStr(ms: number): string {
  if (ms < 60_000)            return `${Math.floor(ms / 1000)}s`
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}min`
  const s = totalSec % 60
  return `${m}min ${String(s).padStart(2, '0')}s`
}

// ── Engine status bar (Fase 9) ───────────────────────────────────────────
// Compact horizontal strip above the cards. Shows: engine running flag,
// uptime, total assets in engine, live SSE client count, snapshot
// freshness, and a 24h gap-fill counter (badge turns amber if > 0).
function EngineStatusBar({ status }: { status: EngineStatus }) {
  const dotClass = status.running ? 'bg-emerald-500' : 'bg-red-500'
  const stateLabel = status.running ? 'RODANDO' : 'PARADO'
  const snapStr = status.snapshotAgeMs != null
    ? agoStr(Date.now() - status.snapshotAgeMs)
    : '—'
  const gapBadge =
    status.gapFills24h === 0
      ? 'bg-[#1a1f2e] text-[#8b8f9a] border-[#2a2e3b]'
      : status.gapFills24h < 10
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : 'bg-red-500/15 text-red-400 border-red-500/30'
  return (
    <div className="mb-4 bg-[#0f1117] border border-[#1f232e] rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className={cn('w-2 h-2 rounded-full', dotClass)} />
        <span className="text-white font-semibold">{stateLabel}</span>
        <span className="text-[#8b8f9a]">uptime <span className="text-white font-mono">{uptimeStr(status.uptimeMs)}</span></span>
      </div>
      <div className="text-[#8b8f9a]">
        Ativos <span className="text-white font-mono">{status.totalAssets}</span>
      </div>
      <div className="text-[#8b8f9a]">
        Streams <span className="text-white font-mono">{status.sseClients}</span>
      </div>
      <div className="text-[#8b8f9a]">
        Snapshot <span className="text-white font-mono">{snapStr}</span>
      </div>
      <div className={cn('ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-medium border', gapBadge)}>
        Gaps 24h: <span className="font-mono font-bold">{status.gapFills24h}</span>
      </div>
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────
// Splits the controls into two groups:
//   • Config (persisted to otc_assets): payout, volatility, speed
//   • Live override (in-memory only, lost on restart): trend bias slider
// "Salvar" hits PATCH; "Aplicar bias" hits /assets/:id/bias separately.
function EditAssetModal({
  asset, onClose, onSaved,
}: {
  asset:   OtcAdminAsset
  onClose: () => void
  onSaved: (a: OtcAdminAsset) => void
}) {
  const [payout, setPayout]                 = useState(String(asset.payout))
  const [volatility, setVolatility]         = useState(String(asset.volatilityBase))
  const [speed, setSpeed]                   = useState(String(asset.speedMultiplier))
  const [enabled, setEnabled]               = useState(asset.enabled)
  const [bias, setBias]                     = useState(asset.live?.trendBias ?? 0)
  const [saving, setSaving]                 = useState(false)
  const [savingBias, setSavingBias]         = useState(false)
  const [error, setError]                   = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()

    const p = Number(payout)
    if (!Number.isInteger(p) || p < 1 || p > 100) {
      setError('Payout entre 1 e 100.'); return
    }
    const v = Number(volatility.replace(',', '.'))
    if (!Number.isFinite(v) || v < 0.00005 || v > 0.01) {
      setError('Volatilidade entre 0.00005 e 0.01.'); return
    }
    const s = Number(speed.replace(',', '.'))
    if (!Number.isFinite(s) || s < 0.1 || s > 5) {
      setError('Velocidade entre 0.1 e 5.'); return
    }

    setSaving(true); setError('')
    try {
      const { data } = await api.patch<AssetResponse>(`/admin/otc/assets/${asset.id}`, {
        payout:          p,
        volatilityBase:  v,
        speedMultiplier: s,
        enabled,
      })
      onSaved(data.asset)
    } catch {
      setError('Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function applyBias() {
    setSavingBias(true); setError('')
    try {
      const { data } = await api.post<AssetResponse>(`/admin/otc/assets/${asset.id}/bias`, { bias })
      onSaved(data.asset)
    } catch {
      setError('Falha ao aplicar bias.')
    } finally {
      setSavingBias(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#0f1117] border border-[#1f232e] rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e]">
          <div>
            <div className="text-xs text-[#8b8f9a]">Editar ativo OTC</div>
            <h2 className="text-base font-semibold text-white">{asset.symbol}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-[#8b8f9a] hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">Payout (%)</label>
            <input
              type="number" min={1} max={100}
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">
              Volatilidade
              <span className="text-[10px] text-[#6b7280] ml-2">tick size como fração do seed (0.0005 ≈ 5bp)</span>
            </label>
            <input
              type="text" inputMode="decimal"
              value={volatility}
              onChange={(e) => setVolatility(e.target.value)}
              placeholder="0.0005"
              className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">
              Velocidade
              <span className="text-[10px] text-[#6b7280] ml-2">multiplicador da taxa base (10Hz). Aplicado após reinício.</span>
            </label>
            <input
              type="text" inputMode="decimal"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              placeholder="1.0"
              className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
            />
          </div>

          <label className="flex items-center justify-between bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 cursor-pointer">
            <div>
              <div className="text-sm text-white">Ativo</div>
              <div className="text-[10px] text-[#8b8f9a]">Desativar impede ticks de serem gerados.</div>
            </div>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={cn('relative w-11 h-6 rounded-full transition-colors', enabled ? 'bg-emerald-500' : 'bg-[#2a2e3b]')}
            >
              <span className={cn(
                'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all',
                enabled ? 'left-[22px]' : 'left-0.5',
              )} />
            </button>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Salvando…' : 'Salvar configuração'}
          </button>
        </form>

        {/* Trend bias — separate section because it's in-memory only */}
        <div className="px-5 py-4 border-t border-[#1f232e] space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6b7280] font-medium mb-1">
              Override em memória (reseta no restart)
            </div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">
              Tendência (bias)
              <span className="text-[10px] text-[#6b7280] ml-2">
                {bias < 0 ? 'puxa pra baixo' : bias > 0 ? 'puxa pra cima' : 'neutro'} — atual: <span className="text-white">{bias.toFixed(2)}</span>
              </span>
            </label>
            <input
              type="range" min={-1} max={1} step={0.05}
              value={bias}
              onChange={(e) => setBias(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <div className="flex justify-between text-[10px] text-[#6b7280] mt-1">
              <span>-1.00 ↓</span><span>0</span><span>↑ +1.00</span>
            </div>
          </div>
          <button
            type="button"
            onClick={applyBias}
            disabled={savingBias}
            className="w-full h-9 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] hover:border-blue-500/40 text-sm text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {savingBias ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Aplicar bias
          </button>
        </div>
      </div>
    </div>
  )
}
