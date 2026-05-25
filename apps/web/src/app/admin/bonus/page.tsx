'use client'

// Fase B1 — Admin bonus codes management.
// CRUD UI for the `bonuses` table: list / create / edit / toggle active / delete.
// Matches the design the founder mocked up — counters at top, table rows with
// inline status toggle + edit + delete.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Gift, RefreshCw, Pencil, Trash2, X, Loader2, Copy, Check, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types — mirror apps/api/src/admin/bonuses/service.ts ──────────────────
type BonusType = 'PERCENTAGE' | 'FIXED'

interface BonusRow {
  id:             string
  code:           string
  type:           BonusType
  value:          string
  minDeposit:     string
  rollover:       number
  active:         boolean
  maxUsesPerUser: number
  expiresAt:      string | null
  activeGrants:   number
  totalGrants:    number
  createdAt:      string
  updatedAt:      string
}

interface ListResponse {
  bonuses: BonusRow[]
}

export default function BonusAdminPage() {
  const [bonuses, setBonuses] = useState<BonusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [editing, setEditing] = useState<BonusRow | null>(null)   // null = closed; row = edit; sentinel for new = blankRow
  const [creating, setCreating] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data } = await api.get<ListResponse>('/admin/bonuses')
      setBonuses(data.bonuses)
    } catch (err: any) {
      // Surface the detail (only present in non-prod) alongside the code so
      // we can debug missing-table / migration-pending issues without SSH.
      const code   = err?.response?.data?.error  ?? 'NETWORK_ERROR'
      const detail = err?.response?.data?.detail ?? err?.response?.data?.message
      setError(detail ? `${code} — ${detail}` : code)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggleActive(b: BonusRow) {
    // Optimistic flip; revert on error.
    setBonuses((rows) => rows.map(r => r.id === b.id ? { ...r, active: !r.active } : r))
    try {
      await api.patch(`/admin/bonuses/${b.id}`, { active: !b.active })
    } catch (err) {
      setBonuses((rows) => rows.map(r => r.id === b.id ? { ...r, active: b.active } : r))
      setError('Erro ao atualizar status.')
    }
  }

  async function deleteBonus(b: BonusRow) {
    if (!confirm(`Excluir bônus "${b.code}"? Não desfaz se houver resgates.`)) return
    try {
      await api.delete(`/admin/bonuses/${b.id}`)
      setBonuses((rows) => rows.filter(r => r.id !== b.id))
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'HAS_GRANTS') {
        setError('Este bônus já foi resgatado por usuários — desative em vez de excluir.')
      } else {
        setError('Erro ao excluir bônus.')
      }
    }
  }

  function copyCode(code: string) {
    navigator.clipboard?.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 1500)
  }

  const total   = bonuses.length
  const active  = bonuses.filter(b => b.active).length
  const inactive = total - active

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Gift size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Bônus</h1>
            <p className="text-xs text-[#8b8f9a]">Gerencie os códigos de bônus para depósitos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            className="h-9 px-3 rounded-lg bg-[#1f232e] border border-[#2a2e3b] text-xs text-[#8b8f9a] hover:text-white hover:border-[#3a4055] flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button
            onClick={() => setCreating(true)}
            className="h-9 px-4 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-600 text-xs font-bold text-white shadow-[0_2px_10px_-2px_rgba(16,185,129,0.5)] hover:-translate-y-px transition-transform flex items-center gap-1.5"
          >
            <Plus size={13} strokeWidth={3} />
            Novo Bônus
          </button>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Counter label="Total de bônus" value={total}   color="emerald" />
        <Counter label="Ativos"          value={active}  color="emerald" />
        <Counter label="Inativos"        value={inactive} color="muted"  />
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[#1f232e] bg-[#13161e] overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_100px_120px_100px_100px_80px] gap-2 px-4 py-3 border-b border-[#1f232e] text-[10px] font-bold uppercase tracking-wider text-[#8b8f9a]">
          <div>Código</div>
          <div>Tipo</div>
          <div>Valor</div>
          <div>Depósito Mín.</div>
          <div>Rollover</div>
          <div>Status</div>
          <div className="text-right">Ações</div>
        </div>

        {loading && bonuses.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#8b8f9a]">
            <Loader2 size={20} className="animate-spin inline-block" />
          </div>
        ) : bonuses.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#8b8f9a]">
            Nenhum bônus cadastrado. Clique em <strong className="text-white">Novo Bônus</strong> pra criar o primeiro.
          </div>
        ) : (
          bonuses.map((b) => (
            <div key={b.id} className="grid grid-cols-[1fr_120px_100px_120px_100px_100px_80px] gap-2 px-4 py-3 items-center border-b border-[#1f232e] last:border-b-0 hover:bg-white/[0.02] transition-colors">
              {/* Code + copy */}
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold tracking-wider">
                  {b.code}
                </span>
                <button
                  onClick={() => copyCode(b.code)}
                  className="text-[#8b8f9a] hover:text-white"
                  title="Copiar código"
                >
                  {copiedCode === b.code ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
                {b.totalGrants > 0 && (
                  <span className="text-[10px] text-[#8b8f9a] ml-1">
                    · {b.activeGrants} ativo{b.activeGrants !== 1 ? 's' : ''} / {b.totalGrants} total
                  </span>
                )}
              </div>

              {/* Type */}
              <div>
                <span className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-bold',
                  b.type === 'PERCENTAGE'
                    ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                    : 'bg-purple-500/15 text-purple-300 border border-purple-500/30',
                )}>
                  {b.type === 'PERCENTAGE' ? 'Porcentagem' : 'Fixo'}
                </span>
              </div>

              {/* Value */}
              <div className="text-sm font-bold text-white">
                {b.type === 'PERCENTAGE' ? `${Number(b.value).toFixed(0)}%` : `R$${Number(b.value).toFixed(0)}`}
              </div>

              {/* Min deposit */}
              <div className="text-sm text-white">R${Number(b.minDeposit).toFixed(0)}</div>

              {/* Rollover */}
              <div className="text-sm text-white">{b.rollover}x</div>

              {/* Status toggle */}
              <div>
                <button
                  onClick={() => toggleActive(b)}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    b.active ? 'bg-emerald-500' : 'bg-[#2a2e3b]',
                  )}
                >
                  <span className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    b.active ? 'translate-x-6' : 'translate-x-1',
                  )} />
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => setEditing(b)}
                  className="w-7 h-7 rounded flex items-center justify-center text-[#8b8f9a] hover:text-white hover:bg-white/5"
                  title="Editar"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => deleteBonus(b)}
                  className="w-7 h-7 rounded flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  title="Excluir"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {(creating || editing) && (
        <BonusFormModal
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

function Counter({ label, value, color }: { label: string; value: number; color: 'emerald' | 'muted' }) {
  return (
    <div className="rounded-xl border border-[#1f232e] bg-[#13161e] px-4 py-4">
      <div className={cn(
        'text-2xl font-bold mb-0.5',
        color === 'emerald' ? 'text-emerald-400' : 'text-white',
      )}>
        {value}
      </div>
      <div className="text-xs text-[#8b8f9a]">{label}</div>
    </div>
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────

function BonusFormModal({
  existing, onClose, onSaved,
}: {
  existing: BonusRow | null
  onClose:  () => void
  onSaved:  () => void
}) {
  const isEdit = existing != null
  const [code,           setCode]           = useState(existing?.code ?? '')
  const [type,           setType]           = useState<BonusType>(existing?.type ?? 'PERCENTAGE')
  const [value,          setValue]          = useState(existing ? Number(existing.value) : 100)
  const [minDeposit,     setMinDeposit]     = useState(existing ? Number(existing.minDeposit) : 100)
  const [rollover,       setRollover]       = useState(existing?.rollover ?? 10)
  const [maxUses,        setMaxUses]        = useState(existing?.maxUsesPerUser ?? 1)
  const [active,         setActive]         = useState(existing?.active ?? true)
  const [submitting,     setSubmitting]     = useState(false)
  const [error,          setError]          = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError('')
    const payload = {
      code:            code.toUpperCase().trim(),
      type,
      value,
      minDeposit,
      rollover,
      maxUsesPerUser:  maxUses,
      active,
    }
    try {
      if (isEdit) await api.patch(`/admin/bonuses/${existing!.id}`, payload)
      else        await api.post('/admin/bonuses', payload)
      onSaved()
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'CODE_TAKEN')        setError('Este código já está em uso.')
      else if (code === 'VALIDATION_ERROR')  setError('Dados inválidos. Verifique os campos.')
      else                                    setError('Erro ao salvar. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md bg-[#1a1e2e] border border-[#2a2e3b] rounded-2xl shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
          <h2 className="text-sm font-bold text-white">{isEdit ? 'Editar bônus' : 'Novo bônus'}</h2>
          <button type="button" onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          <Field label="Código">
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase())}
              placeholder="BONUS200"
              className="w-full h-10 px-3 rounded-lg bg-[#222637] border border-[#2a2e3b] text-sm font-mono font-bold text-white outline-none focus:border-emerald-500/60"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as BonusType)}
                className="w-full h-10 px-2 rounded-lg bg-[#222637] border border-[#2a2e3b] text-sm text-white outline-none focus:border-emerald-500/60"
              >
                <option value="PERCENTAGE">Porcentagem (%)</option>
                <option value="FIXED">Valor fixo (R$)</option>
              </select>
            </Field>
            <Field label={type === 'PERCENTAGE' ? 'Valor (%)' : 'Valor (R$)'}>
              <input
                required
                type="number"
                min={1}
                step={type === 'PERCENTAGE' ? 1 : 10}
                value={value}
                onChange={(e) => setValue(Number(e.target.value) || 0)}
                className="w-full h-10 px-3 rounded-lg bg-[#222637] border border-[#2a2e3b] text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Depósito mín. (R$)">
              <input
                required
                type="number"
                min={0}
                step={10}
                value={minDeposit}
                onChange={(e) => setMinDeposit(Number(e.target.value) || 0)}
                className="w-full h-10 px-3 rounded-lg bg-[#222637] border border-[#2a2e3b] text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </Field>
            <Field label="Rollover (multiplicador)">
              <input
                required
                type="number"
                min={1}
                max={100}
                value={rollover}
                onChange={(e) => setRollover(Number(e.target.value) || 1)}
                className="w-full h-10 px-3 rounded-lg bg-[#222637] border border-[#2a2e3b] text-sm text-white outline-none focus:border-emerald-500/60"
              />
            </Field>
          </div>

          <Field label="Máx. usos por usuário">
            <input
              required
              type="number"
              min={1}
              max={100}
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
              className="w-full h-10 px-3 rounded-lg bg-[#222637] border border-[#2a2e3b] text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </Field>

          <label className="flex items-center gap-2 cursor-pointer text-xs text-[#bdc1cf]">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            Ativo (visível para usuários)
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#2a2e3b] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg bg-[#222637] border border-[#2a2e3b] text-xs font-bold text-[#bdc1cf] hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-10 px-5 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-600 text-xs font-bold text-white shadow-[0_2px_10px_-2px_rgba(16,185,129,0.5)] disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? 'Salvar alterações' : 'Criar bônus'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-[#8b8f9a] mb-1">{label}</span>
      {children}
    </label>
  )
}
