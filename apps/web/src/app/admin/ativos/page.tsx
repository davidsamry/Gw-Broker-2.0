'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  TrendingUp, Globe, Radio, Bitcoin, RefreshCw, Pencil, X, Loader2, Check,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types — must match apps/api/src/admin/assets/service.ts ──────────────────
type AssetCategory = 'OPEN_MARKET' | 'OTC' | 'CRYPTO'

interface AssetRow {
  id:             string
  symbol:         string
  name:           string
  category:       AssetCategory
  payout:         number
  enabled:        boolean
  code1:          string | null
  code2:          string | null
  marketSymbol:   string | null
  displayOrder:   number
  // OTC pricing controls (relevant only for OTC assets — marketSymbol null)
  seedPrice:      string | null
  volatility:     number
  tickIntervalMs: number
  createdAt:      string
  updatedAt:      string
}

interface Counts {
  total:      number
  openMarket: number
  otc:        number
  crypto:     number
}

interface ListResponse {
  assets: AssetRow[]
  counts: Counts
}

type CategoryFilter = 'ALL' | AssetCategory

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  OPEN_MARKET: 'Mercado Aberto',
  OTC:         'OTC',
  CRYPTO:      'Cripto',
}

const CATEGORY_CHIP: Record<AssetCategory, string> = {
  OPEN_MARKET: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  OTC:         'bg-orange-500/15 text-orange-400 border-orange-500/30',
  CRYPTO:      'bg-amber-500/15 text-amber-400 border-amber-500/30',
}

const CATEGORY_ICON: Record<AssetCategory, ReactNode> = {
  OPEN_MARKET: <Globe size={11}  className="text-blue-400" />,
  OTC:         <Radio size={11}  className="text-orange-400" />,
  CRYPTO:      <Bitcoin size={11} className="text-amber-400" />,
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AdminAssetsPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [category, setCategory] = useState<CategoryFilter>('ALL')

  // Bulk payout header
  const [bulkPayout, setBulkPayout] = useState('85')
  const [applying, setApplying]     = useState(false)
  const [bulkOk, setBulkOk]         = useState(false)

  // Edit modal
  const [editing, setEditing] = useState<AssetRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: any = {}
      if (category !== 'ALL') params.category = category
      const res = await api.get<ListResponse>('/admin/assets', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar ativos.')
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => { load() }, [load])

  function patchAsset(id: string, patch: Partial<AssetRow>) {
    setData((prev) => {
      if (!prev) return prev
      return { ...prev, assets: prev.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
    })
  }

  async function toggleEnabled(asset: AssetRow) {
    const next = !asset.enabled
    patchAsset(asset.id, { enabled: next })  // optimistic
    try {
      await api.patch(`/admin/assets/${asset.id}`, { enabled: next })
    } catch {
      patchAsset(asset.id, { enabled: asset.enabled })  // revert
      setError('Falha ao atualizar status.')
    }
  }

  async function applyBulkPayout(e: FormEvent) {
    e.preventDefault()
    const v = Number(bulkPayout)
    if (!Number.isInteger(v) || v < 1 || v > 100) {
      setError('Payout deve estar entre 1 e 100.')
      return
    }
    setApplying(true); setError(''); setBulkOk(false)
    try {
      const body: any = { payout: v }
      if (category !== 'ALL') body.category = category
      await api.post('/admin/assets/bulk-payout', body)
      // Refresh to get the new values
      await load()
      setBulkOk(true)
      setTimeout(() => setBulkOk(false), 2200)
    } catch {
      setError('Falha ao aplicar payout em massa.')
    } finally {
      setApplying(false)
    }
  }

  const TABS: { value: CategoryFilter; label: string; count: number; icon?: ReactNode }[] = [
    { value: 'ALL',         label: 'Todos',          count: data?.counts.total      ?? 0, icon: <TrendingUp size={11} className="text-emerald-400" /> },
    { value: 'OPEN_MARKET', label: 'Mercado Aberto', count: data?.counts.openMarket ?? 0, icon: CATEGORY_ICON.OPEN_MARKET },
    { value: 'OTC',         label: 'OTC',            count: data?.counts.otc        ?? 0, icon: CATEGORY_ICON.OTC },
    { value: 'CRYPTO',      label: 'Cripto',         count: data?.counts.crypto     ?? 0, icon: CATEGORY_ICON.CRYPTO },
  ]

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Ativos</h1>
          <p className="text-xs md:text-sm text-[#8b8f9a] mt-1">Gerencie os ativos disponíveis para trading</p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={applyBulkPayout} className="flex items-center gap-2">
            <div className="flex items-center bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg overflow-hidden focus-within:border-emerald-500/40">
              <input
                type="number"
                min={1}
                max={100}
                value={bulkPayout}
                onChange={(e) => setBulkPayout(e.target.value)}
                className="w-16 px-2 py-2 bg-transparent text-sm text-white outline-none text-center"
              />
              <span className="px-2 py-2 text-xs text-[#8b8f9a] border-l border-[#2a2e3b]">%</span>
            </div>
            <button
              type="submit"
              disabled={applying}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white transition-colors disabled:opacity-50',
                bulkOk
                  ? 'bg-emerald-600/40 border border-emerald-500'
                  : 'bg-[#1a1f2e] border border-[#2a2e3b] hover:border-emerald-500/40',
              )}
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : (bulkOk ? <Check size={13} /> : null)}
              {category === 'ALL' ? 'Aplicar a todos' : `Aplicar a ${CATEGORY_LABEL[category]}`}
            </button>
          </form>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-sm text-white hover:border-emerald-500/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setCategory(t.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              category === t.value
                ? 'bg-[#1a1f2e] border border-[#2a2e3b] text-white'
                : 'text-[#8b8f9a] hover:text-white border border-transparent',
            )}
          >
            {t.icon}
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#0f1117] border border-[#1f232e] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0d13] border-b border-[#1f232e] text-[11px] uppercase text-[#8b8f9a]">
              <tr>
                <th className="text-left  font-medium px-4 py-3">Ativo</th>
                <th className="text-left  font-medium px-4 py-3">Nome</th>
                <th className="text-left  font-medium px-4 py-3">Categoria</th>
                <th className="text-right font-medium px-4 py-3">Payout</th>
                <th className="text-center font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[#8b8f9a] text-sm">Carregando…</td></tr>
              )}
              {!loading && data && data.assets.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[#8b8f9a] text-sm">Nenhum ativo encontrado.</td></tr>
              )}
              {data?.assets.map((a) => (
                <tr key={a.id} className="border-b border-[#1f232e] last:border-b-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={13} className="text-emerald-400 flex-shrink-0" />
                      <span className="font-bold text-white">{a.symbol}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#c3c6cf]">{a.name}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border', CATEGORY_CHIP[a.category])}>
                      {CATEGORY_ICON[a.category]}
                      {CATEGORY_LABEL[a.category]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-400 whitespace-nowrap">{a.payout}%</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center">
                      <button
                        onClick={() => toggleEnabled(a)}
                        className={cn(
                          'relative w-11 h-6 rounded-full transition-colors',
                          a.enabled ? 'bg-emerald-500' : 'bg-[#2a2e3b]',
                        )}
                        title={a.enabled ? 'Ativo' : 'Inativo'}
                      >
                        <span className={cn(
                          'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all',
                          a.enabled ? 'left-[22px]' : 'left-0.5',
                        )} />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(a)}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] hover:border-emerald-500/40 text-[#8b8f9a] hover:text-white transition-colors"
                      title="Editar ativo"
                    >
                      <Pencil size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditAssetModal
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            patchAsset(updated.id, updated)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ── Edit modal ───────────────────────────────────────────────────────────────
// Always edits name + payout. For OTC assets (no marketSymbol) also exposes
// the pricing knobs the OTC worker reads: seedPrice (baseline) and
// volatility (tick size as fraction). After saving an OTC asset, the modal
// fires POST /admin/assets/otc-reload so the worker re-reads its cache —
// the change takes effect on the next tick instead of needing a process
// restart.
function EditAssetModal({
  asset, onClose, onSaved,
}: {
  asset:   AssetRow
  onClose: () => void
  onSaved: (a: AssetRow) => void
}) {
  const isOtc = !asset.marketSymbol

  const [name, setName]             = useState(asset.name)
  const [payout, setPayout]         = useState(String(asset.payout))
  const [seedPrice, setSeedPrice]   = useState(asset.seedPrice ?? '')
  const [volatility, setVolatility] = useState(String(asset.volatility))
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 1) { setError('Nome obrigatório.'); return }

    const p = Number(payout)
    if (!Number.isInteger(p) || p < 1 || p > 100) {
      setError('Payout entre 1 e 100.'); return
    }

    // Build PATCH body. seedPrice/volatility only sent if user actually
    // changed them — keeps validation server-side from rejecting unrelated
    // edits when an admin clears a field by accident.
    const body: Record<string, unknown> = { name: name.trim(), payout: p }
    if (isOtc) {
      const trimmedSeed = seedPrice.trim()
      if (trimmedSeed === '') {
        body.seedPrice = null  // explicit clear → worker skips this asset
      } else {
        const sp = Number(trimmedSeed.replace(',', '.'))
        if (!Number.isFinite(sp) || sp <= 0) {
          setError('Seed price deve ser um número positivo.'); return
        }
        body.seedPrice = sp
      }
      const v = Number(volatility.replace(',', '.'))
      if (!Number.isFinite(v) || v < 0 || v > 0.1) {
        setError('Volatilidade entre 0 e 0.1 (ex.: 0.0005).'); return
      }
      body.volatility = v
    }

    setSaving(true); setError('')
    try {
      const { data } = await api.patch(`/admin/assets/${asset.id}`, body)
      // For OTC, ping the worker so the new seed/vol take effect on next
      // tick (otherwise the in-memory cache stays stale until restart).
      // Best-effort — UI doesn't block on this; cache reseeds on next deploy
      // even if the call fails.
      if (isOtc) {
        api.post('/admin/assets/otc-reload').catch(() => {})
      }
      if (data?.asset) onSaved(data.asset)
      else onClose()
    } catch {
      setError('Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#0f1117] border border-[#1f232e] rounded-2xl overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e]">
          <div>
            <div className="text-xs text-[#8b8f9a]">Editar ativo</div>
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
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">Payout (%)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
            />
          </div>

          {isOtc && (
            <>
              <div className="pt-2 border-t border-[#1f232e]">
                <div className="text-[10px] uppercase tracking-wider text-[#6b7280] font-medium mb-2">
                  Preço OTC (motor server-side)
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">
                    Seed price
                    <span className="text-[10px] text-[#6b7280] ml-2">baseline do random walk; deixe vazio pra desabilitar</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={seedPrice}
                    onChange={(e) => setSeedPrice(e.target.value)}
                    placeholder="ex.: 1.0854"
                    className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
                  />
                </div>
                <div className="mt-3">
                  <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">
                    Volatilidade
                    <span className="text-[10px] text-[#6b7280] ml-2">fração do seed por tick (0.0005 ≈ 5bp)</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={volatility}
                    onChange={(e) => setVolatility(e.target.value)}
                    placeholder="ex.: 0.0005"
                    className="w-full bg-[#1a1f2e] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40"
                  />
                </div>
              </div>
            </>
          )}

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
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </form>
      </div>
    </div>
  )
}
