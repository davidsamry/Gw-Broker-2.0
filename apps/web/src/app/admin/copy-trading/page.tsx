'use client'

// Admin Copy Trading — gerencia os 8 traders. Cada card abre um formulário
// inline pra editar todos os campos (espelha o padrão de /admin/ranking,
// mas com card+form por causa da quantidade de campos). PATCH por trader.

import { useCallback, useEffect, useState } from 'react'
import { Copy, RefreshCw, Pencil, Check, X, Loader2, AlertCircle, Crown, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AdminTrader {
  id:            string
  name:          string
  countryCode:   string
  avatarUrl:     string | null
  vip:           boolean
  paid:          boolean
  accessPrice:   number
  weeklyGainPct: number
  copiers:       number
  copiedTrades:  number
  commissionPct: number
  profitPct:     number
  lossPct:       number
  active:        boolean
  displayOrder:  number
  activeCopiers: number
}

type Draft = Partial<AdminTrader>

interface AdminSub {
  id:          string
  userId:      string
  userName:    string
  userEmail:   string
  traderId:    string
  traderName:  string
  paid:        boolean
  pricePaid:   number
  status:      string
  activatedAt: string
  nextCycleAt: string | null
  settledOps:  number
  settledPnl:  number
}
interface SubsSummary {
  total: number; active: number; cancelled: number
  paid: number; free: number; revenue: number; netUserPnl: number
}

export default function AdminCopyTradingPage() {
  const [traders, setTraders] = useState<AdminTrader[]>([])
  const [subs,    setSubs]    = useState<AdminSub[]>([])
  const [summary, setSummary] = useState<SubsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [editId,  setEditId]  = useState<string | null>(null)
  const [draft,   setDraft]   = useState<Draft>({})
  const [saving,  setSaving]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [tradersRes, subsRes] = await Promise.all([
        api.get<{ traders: AdminTrader[] }>('/admin/copy-trading'),
        api.get<{ subscriptions: AdminSub[]; summary: SubsSummary }>('/admin/copy-trading/subscriptions'),
      ])
      setTraders(tradersRes.data.traders)
      setSubs(subsRes.data.subscriptions)
      setSummary(subsRes.data.summary)
    } catch {
      setError('Falha ao carregar dados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function startEdit(t: AdminTrader) {
    setEditId(t.id)
    setDraft({ ...t })
  }
  function cancelEdit() {
    setEditId(null); setDraft({})
  }

  async function save(id: string) {
    setSaving(true); setError('')
    try {
      // Só envia os campos editáveis.
      const body = {
        name:          draft.name,
        countryCode:   draft.countryCode,
        avatarUrl:     draft.avatarUrl ?? null,
        vip:           draft.vip,
        paid:          draft.paid,
        accessPrice:   Number(draft.accessPrice),
        weeklyGainPct: Number(draft.weeklyGainPct),
        copiers:       Number(draft.copiers),
        copiedTrades:  Number(draft.copiedTrades),
        commissionPct: Number(draft.commissionPct),
        profitPct:     Number(draft.profitPct),
        lossPct:       Number(draft.lossPct),
        active:        draft.active,
        displayOrder:  Number(draft.displayOrder),
      }
      const { data } = await api.patch<{ trader: AdminTrader }>(`/admin/copy-trading/${id}`, body)
      setTraders((prev) => prev.map((t) => (t.id === id ? data.trader : t)))
      cancelEdit()
    } catch {
      setError('Falha ao salvar. Verifique os valores.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(t: AdminTrader) {
    try {
      const { data } = await api.patch<{ trader: AdminTrader }>(`/admin/copy-trading/${t.id}`, { active: !t.active })
      setTraders((prev) => prev.map((x) => (x.id === t.id ? data.trader : x)))
    } catch {
      setError('Falha ao alterar status.')
    }
  }

  const set = (k: keyof Draft) => (v: any) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Copy size={20} className="text-[#3080ff]" />
          <h1 className="text-lg font-bold text-white">Copy Trading</h1>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 text-xs text-[#8b8f9a] hover:text-white transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="space-y-3">
        {traders.map((t) => {
          const editing = editId === t.id
          return (
            <div key={t.id} className="rounded-xl bg-[#171b27] border border-[#252a3a] p-4">
              {/* Header do card */}
              <div className="flex items-center gap-3">
                <img
                  src={t.avatarUrl || `https://flagcdn.com/w80/${t.countryCode}.png`}
                  alt={t.name}
                  className="w-9 h-9 rounded-full object-cover border border-[#2a2e3b] bg-[#252a3a]"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = `https://flagcdn.com/w80/${t.countryCode}.png` }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white truncate">{t.name}</span>
                    {t.vip && <Crown size={12} className="text-[#3080ff]" />}
                    <span className={cn(
                      'text-[9px] font-bold px-1.5 py-px rounded',
                      t.paid ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400',
                    )}>
                      {t.paid ? `PAGO R$ ${t.accessPrice.toFixed(0)}` : 'GRÁTIS'}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#8b8f9a] mt-0.5">
                    Ganho {t.weeklyGainPct}% · {t.copiers} copiadores ({t.activeCopiers} reais) · {t.copiedTrades} ops
                  </div>
                </div>
                <button
                  onClick={() => toggleActive(t)}
                  className={cn(
                    'text-[10px] font-bold px-2 py-1 rounded transition',
                    t.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#252a3a] text-[#8b8f9a]',
                  )}
                >
                  {t.active ? 'Ativo' : 'Inativo'}
                </button>
                {!editing && (
                  <button onClick={() => startEdit(t)} className="text-[#8b8f9a] hover:text-white transition-colors">
                    <Pencil size={15} />
                  </button>
                )}
              </div>

              {/* Form de edição */}
              {editing && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Nome">
                    <input className={inp} value={draft.name ?? ''} onChange={(e) => set('name')(e.target.value)} />
                  </Field>
                  <Field label="País (ISO-2)">
                    <input className={inp} value={draft.countryCode ?? ''} maxLength={2} onChange={(e) => set('countryCode')(e.target.value.toLowerCase())} />
                  </Field>
                  <Field label="Avatar URL (opcional)">
                    <input className={inp} value={draft.avatarUrl ?? ''} onChange={(e) => set('avatarUrl')(e.target.value)} placeholder="https://..." />
                  </Field>
                  <Field label="Ganho semanal %">
                    <input className={inp} type="number" value={draft.weeklyGainPct ?? 0} onChange={(e) => set('weeklyGainPct')(e.target.value)} />
                  </Field>
                  <Field label="Valor acesso (R$)">
                    <input className={inp} type="number" value={draft.accessPrice ?? 0} onChange={(e) => set('accessPrice')(e.target.value)} />
                  </Field>
                  <Field label="Comissão %">
                    <input className={inp} type="number" value={draft.commissionPct ?? 0} onChange={(e) => set('commissionPct')(e.target.value)} />
                  </Field>
                  <Field label="Copiadores">
                    <input className={inp} type="number" value={draft.copiers ?? 0} onChange={(e) => set('copiers')(e.target.value)} />
                  </Field>
                  <Field label="Operações copiadas">
                    <input className={inp} type="number" value={draft.copiedTrades ?? 0} onChange={(e) => set('copiedTrades')(e.target.value)} />
                  </Field>
                  <Field label="Ordem">
                    <input className={inp} type="number" value={draft.displayOrder ?? 0} onChange={(e) => set('displayOrder')(e.target.value)} />
                  </Field>
                  <Field label="Lucro %">
                    <input className={inp} type="number" value={draft.profitPct ?? 0} onChange={(e) => set('profitPct')(e.target.value)} />
                  </Field>
                  <Field label="Perda %">
                    <input className={inp} type="number" value={draft.lossPct ?? 0} onChange={(e) => set('lossPct')(e.target.value)} />
                  </Field>
                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-white cursor-pointer">
                      <input type="checkbox" checked={!!draft.vip} onChange={(e) => set('vip')(e.target.checked)} /> VIP
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-white cursor-pointer">
                      <input type="checkbox" checked={!!draft.paid} onChange={(e) => set('paid')(e.target.checked)} /> Pago
                    </label>
                  </div>

                  <div className="col-span-2 md:col-span-3 flex gap-2 pt-1">
                    <button
                      onClick={() => save(t.id)}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar
                    </button>
                    <button onClick={cancelEdit} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-[#8b8f9a] border border-[#2a2e3b] hover:text-white">
                      <X size={14} /> Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Assinaturas & Compras (controle) ── */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Users size={18} className="text-[#3080ff]" />
          <h2 className="text-base font-bold text-white">Assinaturas & Compras</h2>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Assinaturas" value={`${summary.total}`} hint={`${summary.active} ativas · ${summary.cancelled} canceladas`} />
            <Stat label="Compras pagas" value={`${summary.paid}`} hint={`${summary.free} grátis`} />
            <Stat label="Receita (compras)" value={`R$ ${brl(summary.revenue)}`} hint="acesso a copys pagos" valueClass="text-emerald-400" />
            <Stat
              label="Resultado dos usuários"
              value={`${summary.netUserPnl >= 0 ? '+' : '-'}R$ ${brl(Math.abs(summary.netUserPnl))}`}
              hint={summary.netUserPnl <= 0 ? 'casa lucrou' : 'casa pagou'}
              valueClass={summary.netUserPnl >= 0 ? 'text-red-400' : 'text-emerald-400'}
            />
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-[#252a3a]">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-[#171b27] text-[#8b8f9a]">
              <tr>
                <th className="text-left  px-3 py-2 font-medium">Usuário</th>
                <th className="text-left  px-3 py-2 font-medium">Trader</th>
                <th className="text-left  px-3 py-2 font-medium">Tipo</th>
                <th className="text-left  px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Ops</th>
                <th className="text-right px-3 py-2 font-medium">Resultado</th>
                <th className="text-left  px-3 py-2 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-t border-[#252a3a]">
                  <td className="px-3 py-2">
                    <div className="text-white">{s.userName}</div>
                    <div className="text-[10px] text-[#8b8f9a]">{s.userEmail}</div>
                  </td>
                  <td className="px-3 py-2 text-white">{s.traderName}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-px rounded',
                      s.paid ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400',
                    )}>
                      {s.paid ? `PAGO R$ ${brl(s.pricePaid)}` : 'GRÁTIS'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('text-[10px] font-bold', s.status === 'ACTIVE' ? 'text-emerald-400' : 'text-[#8b8f9a]')}>
                      {s.status === 'ACTIVE' ? 'Ativo' : 'Cancelado'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-white">{s.settledOps}</td>
                  <td className={cn('px-3 py-2 text-right font-bold', s.settledPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {s.settledPnl >= 0 ? '+' : '-'}R$ {brl(Math.abs(s.settledPnl))}
                  </td>
                  <td className="px-3 py-2 text-[#8b8f9a]">{fmtDate(s.activatedAt)}</td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-[#8b8f9a]">Nenhuma assinatura ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const inp = 'w-full px-2.5 py-1.5 rounded-lg bg-[#0e1019] border border-[#2a2e3b] text-xs text-white focus:outline-none focus:border-[#3080ff]'

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function Stat({ label, value, hint, valueClass }: { label: string; value: string; hint?: string; valueClass?: string }) {
  return (
    <div className="rounded-xl bg-[#171b27] border border-[#252a3a] p-3">
      <div className="text-[10px] text-[#8b8f9a] uppercase tracking-wide">{label}</div>
      <div className={cn('text-lg font-extrabold mt-0.5', valueClass ?? 'text-white')}>{value}</div>
      {hint && <div className="text-[10px] text-[#8b8f9a] mt-0.5">{hint}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-[#8b8f9a] mb-1">{label}</label>
      {children}
    </div>
  )
}
