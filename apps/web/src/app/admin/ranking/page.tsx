'use client'

// Admin pool of fictitious ranking entries.
// Mirrors the layout pattern of /admin/usuarios + /admin/bonus: a list
// table + an inline "Add new" panel + modal-less edit (each row toggles
// to editing mode in place). Hard-delete with confirm() — no extra modal
// since the entries are pure marketing data (not user PII).

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Trophy, RefreshCw, Plus, Pencil, Trash2, Check, X, Loader2, AlertCircle, Clock,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface RankingEntry {
  id:          string
  name:        string
  countryCode: string
  amount:      number
  active:      boolean
  updatedAt:   string
  createdAt:   string
}

// Limited country codes the panel suggests as quick picks. Anything ISO
// alpha-2 works server-side; the dropdown is just convenience.
const POPULAR_COUNTRIES: Array<{ code: string; label: string }> = [
  { code: 'br', label: 'Brasil' },
  { code: 'us', label: 'Estados Unidos' },
  { code: 'pt', label: 'Portugal' },
  { code: 'ar', label: 'Argentina' },
  { code: 'mx', label: 'México' },
  { code: 'gb', label: 'Reino Unido' },
  { code: 'de', label: 'Alemanha' },
  { code: 'fr', label: 'França' },
  { code: 'es', label: 'Espanha' },
  { code: 'it', label: 'Itália' },
  { code: 'jp', label: 'Japão' },
  { code: 'kr', label: 'Coreia do Sul' },
  { code: 'cn', label: 'China' },
  { code: 'in', label: 'Índia' },
  { code: 'id', label: 'Indonésia' },
  { code: 'ru', label: 'Rússia' },
  { code: 'ng', label: 'Nigéria' },
  { code: 'pe', label: 'Peru' },
  { code: 'co', label: 'Colômbia' },
  { code: 'cl', label: 'Chile' },
  { code: 'bo', label: 'Bolívia' },
]

interface ListResponse   { entries: RankingEntry[] }
interface SingleResponse { entry:   RankingEntry }

export default function AdminRankingPage() {
  const [entries, setEntries] = useState<RankingEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  // Countdown to next 3h rotation — purely informational.
  const [nextRotationMs, setNextRotationMs] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data } = await api.get<ListResponse>('/admin/ranking')
      setEntries(data.entries)
      // Compute next 3h boundary based on UTC clock to match server logic.
      const ROTATION_MS = 3 * 60 * 60 * 1000
      const now = Date.now()
      const nextBoundary = Math.ceil(now / ROTATION_MS) * ROTATION_MS
      setNextRotationMs(nextBoundary - now)
    } catch {
      setError('Falha ao carregar entradas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Countdown tick every minute.
  useEffect(() => {
    if (nextRotationMs == null) return
    const id = setInterval(() => {
      setNextRotationMs((ms) => (ms != null ? Math.max(0, ms - 60_000) : null))
    }, 60_000)
    return () => clearInterval(id)
  }, [nextRotationMs])

  async function createEntry(input: { name: string; countryCode: string; amount: number }) {
    try {
      const { data } = await api.post<SingleResponse>('/admin/ranking', { ...input, active: true })
      setEntries((prev) => [data.entry, ...prev])
    } catch {
      setError('Erro ao adicionar.')
    }
  }

  async function updateEntry(id: string, input: Partial<RankingEntry>) {
    try {
      const { data } = await api.patch<SingleResponse>(`/admin/ranking/${id}`, input)
      setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)))
      setEditingId(null)
    } catch {
      setError('Erro ao salvar.')
    }
  }

  async function toggleActive(entry: RankingEntry) {
    await updateEntry(entry.id, { active: !entry.active })
  }

  async function removeEntry(entry: RankingEntry) {
    if (!confirm(`Remover "${entry.name}" do pool?`)) return
    try {
      await api.delete(`/admin/ranking/${entry.id}`)
      setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    } catch {
      setError('Erro ao remover.')
    }
  }

  const activeCount = entries.filter((e) => e.active).length

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <Trophy size={20} className="text-yellow-400" />
            Ranking — Pool fictício
          </h1>
          <p className="text-xs md:text-sm text-[#8b8f9a] mt-1">
            Usuários fictícios que aparecem no leaderboard. O motor sorteia 25 a cada 3 horas.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-sm text-white hover:border-blue-500/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Stat label="Total no pool" value={entries.length} />
        <Stat label="Ativos (entram no sorteio)" value={activeCount} accent={activeCount < 25 ? 'warn' : 'ok'} />
        <StatTime label="Próxima rotação" ms={nextRotationMs} />
      </div>

      {activeCount < 25 && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-300 flex items-start gap-3">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <p>Você tem só <strong>{activeCount}</strong> entradas ativas. O leaderboard mostra 25, então alguns slots vão se repetir / faltar. Adicione mais pra ter um sorteio com variedade.</p>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {/* New entry form */}
      <NewEntryForm onCreate={createEntry} />

      {/* Pool table */}
      <div className="mt-6 rounded-xl bg-[#1a1f2e] border border-[#2a2e3b] overflow-hidden">
        <div className="hidden md:grid grid-cols-[40px_1fr_140px_180px_120px_120px] gap-3 px-4 py-3 border-b border-[#2a2e3b] text-[10px] uppercase tracking-wider text-[#7c8195] font-semibold">
          <div></div>
          <div>Nome</div>
          <div>País</div>
          <div className="text-right">Valor (R$)</div>
          <div className="text-center">Ativo</div>
          <div className="text-right">Ações</div>
        </div>
        {loading && entries.length === 0 ? (
          <div className="text-center py-12 text-[#8b8f9a] text-sm">Carregando…</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-[#8b8f9a] text-sm">Pool vazio. Adicione entradas acima.</div>
        ) : (
          entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              isEditing={editingId === entry.id}
              onStartEdit={() => setEditingId(entry.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(input) => updateEntry(entry.id, input)}
              onToggleActive={() => toggleActive(entry)}
              onRemove={() => removeEntry(entry)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── New entry form ────────────────────────────────────────────────────────
function NewEntryForm({ onCreate }: { onCreate: (i: { name: string; countryCode: string; amount: number }) => Promise<void> }) {
  const [name,        setName]        = useState('')
  const [countryCode, setCountryCode] = useState('br')
  const [amount,      setAmount]      = useState('')
  const [saving,      setSaving]      = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    const a = parseFloat(amount.replace(',', '.'))
    if (n.length < 2 || isNaN(a) || a < 0) return
    setSaving(true)
    try {
      await onCreate({ name: n, countryCode, amount: a })
      setName(''); setAmount('')   // keep countryCode for fast successive entries
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-[#1a1f2e] border border-[#2a2e3b] p-4 grid grid-cols-1 md:grid-cols-[1fr_160px_160px_120px] gap-3 items-end">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#7c8195] font-semibold mb-1">Nome (ex: João S.)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Apollo I."
          maxLength={60}
          className="w-full bg-[#222637] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#7c8195] font-semibold mb-1">País</label>
        <select
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          className="w-full bg-[#222637] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
        >
          {POPULAR_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} className="bg-[#1e2535]">{c.code.toUpperCase()} — {c.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#7c8195] font-semibold mb-1">Valor R$</label>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="35.000,00"
          className="w-full bg-[#222637] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Adicionar
      </button>
    </form>
  )
}

// ── Entry row (display or inline-edit mode) ───────────────────────────────
function EntryRow({
  entry, isEditing, onStartEdit, onCancelEdit, onSave, onToggleActive, onRemove,
}: {
  entry:        RankingEntry
  isEditing:    boolean
  onStartEdit:  () => void
  onCancelEdit: () => void
  onSave:       (input: Partial<RankingEntry>) => Promise<void>
  onToggleActive: () => void
  onRemove:     () => void
}) {
  const [name,        setName]        = useState(entry.name)
  const [countryCode, setCountryCode] = useState(entry.countryCode)
  const [amount,      setAmount]      = useState(entry.amount.toString())
  const [saving,      setSaving]      = useState(false)

  // Re-seed local state when the underlying entry changes (e.g. another row's save refetched).
  useEffect(() => {
    setName(entry.name)
    setCountryCode(entry.countryCode)
    setAmount(entry.amount.toString())
  }, [entry])

  async function save() {
    setSaving(true)
    try {
      await onSave({ name, countryCode, amount: parseFloat(amount.replace(',', '.')) || 0 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn(
      'grid grid-cols-1 md:grid-cols-[40px_1fr_140px_180px_120px_120px] gap-3 px-4 py-3 border-b border-[#1f232e]/50 items-center',
      !entry.active && 'opacity-50',
    )}>
      <div className="w-9 h-9 rounded-full bg-[#222637] border border-[#2a2e3b] flex items-center justify-center text-[#8b8f9a] text-xs font-bold">
        {entry.name.charAt(0).toUpperCase()}
      </div>

      {/* Name */}
      {isEditing ? (
        <input value={name} onChange={(e) => setName(e.target.value)} className="bg-[#222637] border border-[#2a2e3b] rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500/60" />
      ) : (
        <div className="text-sm text-white font-medium truncate">{entry.name}</div>
      )}

      {/* Country */}
      {isEditing ? (
        <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="bg-[#222637] border border-[#2a2e3b] rounded px-2 py-1.5 text-sm text-white outline-none">
          {POPULAR_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} className="bg-[#1e2535]">{c.code.toUpperCase()}</option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://flagcdn.com/w40/${entry.countryCode}.png`}
            alt={entry.countryCode}
            width={18}
            height={18}
            className="rounded-full object-cover border border-white/10 flex-shrink-0"
            style={{ width: 18, height: 18 }}
          />
          <span className="text-xs text-[#bdc1cf] uppercase">{entry.countryCode}</span>
        </div>
      )}

      {/* Amount */}
      {isEditing ? (
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-[#222637] border border-[#2a2e3b] rounded px-2 py-1.5 text-sm text-white outline-none text-right focus:border-blue-500/60" />
      ) : (
        <div className="text-right text-sm font-bold text-white">
          R$ {entry.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}

      {/* Active toggle */}
      <div className="flex justify-center">
        <button
          onClick={onToggleActive}
          className={cn(
            'relative inline-block w-10 h-5 rounded-full transition-colors',
            entry.active ? 'bg-emerald-500' : 'bg-[#2a2e3b]',
          )}
        >
          <div className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            entry.active && 'translate-x-5',
          )} />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1">
        {isEditing ? (
          <>
            <button onClick={save} disabled={saving} className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50" title="Salvar">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button onClick={onCancelEdit} className="p-1.5 rounded-md text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors" title="Cancelar">
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <button onClick={onStartEdit} className="p-1.5 rounded-md text-blue-400 hover:bg-blue-500/10 transition-colors" title="Editar">
              <Pencil size={14} />
            </button>
            <button onClick={onRemove} className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 transition-colors" title="Remover">
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: number; accent?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-xl bg-[#1a1f2e] border border-[#2a2e3b] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[#7c8195] font-semibold">{label}</div>
      <div className={cn(
        'text-2xl font-bold mt-1',
        accent === 'ok'   ? 'text-emerald-400' :
        accent === 'warn' ? 'text-yellow-400'  :
        'text-white',
      )}>{value}</div>
    </div>
  )
}

function StatTime({ label, ms }: { label: string; ms: number | null }) {
  const text = ms == null ? '—' : formatCountdown(ms)
  return (
    <div className="rounded-xl bg-[#1a1f2e] border border-[#2a2e3b] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[#7c8195] font-semibold flex items-center gap-1.5">
        <Clock size={11} /> {label}
      </div>
      <div className="text-2xl font-bold mt-1 text-white">{text}</div>
    </div>
  )
}

function formatCountdown(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m.toString().padStart(2, '0')}m`
}
