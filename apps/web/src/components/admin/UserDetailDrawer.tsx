'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, KeyRound, AlertCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'

interface AccountRow {
  id:               string
  type:             'REAL' | 'DEMO'
  balance:          string
  bonusBalance:     string
  rolloverRequired: string
  rolloverProgress: string
  currency:         string
}

interface UserDetail {
  user: {
    id: string
    name: string
    email: string
    role: 'USER' | 'ADMIN'
    kycStatus: string
    blocked: boolean
    blockedAt: string | null
    blockedReason: string | null
    twoFactorEnabled: boolean
    nickname: string | null
    lastName: string | null
    birthDate: string | null
    cpf: string | null
    phone: string | null
    country: string | null
    address: string | null
    isFake: boolean
    copyTraderEnabled: boolean
    payoutOverrideForex: number | null
    payoutOverrideOtc: number | null
    payoutOverrideCrypto: number | null
    canTradeForex: boolean
    canTradeOtc: boolean
    canTradeCrypto: boolean
    createdAt: string
  }
  accounts: AccountRow[]
}

interface Props {
  userId:    string
  onClose:   () => void
  onChanged: () => void
}

// Single-page edit drawer. All fields from the design mockup wired up
// to PATCH /admin/users/:id (profile + toggles) + POST /:id/bonus
// (lump-sum bonus/rollover) + POST /:id/reset-password. Saves are
// debounced under a single "Salvar alterações" button at the bottom so
// the admin reviews everything before commit.
export function UserDetailDrawer({ userId, onClose, onChanged }: Props) {
  const [data, setData]       = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  const me     = useAuthStore((s) => s.user)
  const isSelf = me?.id === userId

  // ── Form state — initialized after fetch ────────────────────────────────
  const [form, setForm] = useState<EditState | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<UserDetail>(`/admin/users/${userId}`)
      setData(res.data)
      setForm(toFormState(res.data))
    } catch (err: any) {
      // Surface server detail so column-missing errors (migration not
      // applied yet) are diagnosable from the UI instead of generic
      // "Erro ao carregar detalhe."
      const detail = err?.response?.data?.detail
      const code   = err?.response?.data?.error
      if (detail && /column .* does not exist/i.test(detail)) {
        setError('Migration pendente no banco. Rode `prisma migrate deploy` no serviço API (ou reimplante).')
      } else if (detail) {
        setError(`Erro: ${detail}`)
      } else if (code) {
        setError(`Erro: ${code}`)
      } else {
        setError('Erro ao carregar detalhe.')
      }
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [userId])

  // Close on ESC.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const realAccount = useMemo(
    () => data?.accounts.find((a) => a.type === 'REAL') ?? null,
    [data],
  )

  const rolloverPct = useMemo(() => {
    if (!form) return 0
    const req  = parseFloat(form.rolloverRequired || '0') || 0
    const done = parseFloat(form.rolloverProgress || '0') || 0
    if (req <= 0) return 0
    return Math.min(100, Math.round((done / req) * 100))
  }, [form])

  async function save() {
    if (!data || !form || !realAccount) return
    setSaving(true); setSaveMsg(null)
    try {
      // PATCH /admin/users/:id — profile, toggles, payout, permissions
      await api.patch(`/admin/users/${userId}`, {
        name:                 form.name,
        lastName:             form.lastName || null,
        email:                form.email,
        cpf:                  form.cpf || null,
        phone:                form.phone || null,
        isFake:               form.isFake,
        copyTraderEnabled:    form.copyTraderEnabled,
        canTradeForex:        form.canTradeForex,
        canTradeOtc:          form.canTradeOtc,
        canTradeCrypto:       form.canTradeCrypto,
        blocked:              form.blocked,
        payoutOverrideForex:  form.payoutForexEnabled  ? toIntOrNull(form.payoutForexValue)  : null,
        payoutOverrideOtc:    form.payoutOtcEnabled    ? toIntOrNull(form.payoutOtcValue)    : null,
        payoutOverrideCrypto: form.payoutCryptoEnabled ? toIntOrNull(form.payoutCryptoValue) : null,
      })

      // POST /:id/balance — only if real balance changed (creates a
      // ledger entry, not a silent overwrite).
      const newBalance = parseFloat(form.balance || '0') || 0
      const curBalance = parseFloat(realAccount.balance || '0') || 0
      const delta = newBalance - curBalance
      if (Math.abs(delta) > 0.005) {
        await api.post(`/admin/users/${userId}/balance`, {
          accountType: 'REAL',
          amount: delta,
          reason: 'Ajuste manual via tela de edição de usuário',
        })
      }

      // POST /:id/bonus — lump-sum bonus + rollover
      await api.post(`/admin/users/${userId}/bonus`, {
        accountId:        realAccount.id,
        bonusBalance:     parseFloat(form.bonusBalance || '0') || 0,
        rolloverRequired: parseFloat(form.rolloverRequired || '0') || 0,
        rolloverProgress: parseFloat(form.rolloverProgress || '0') || 0,
      })

      setSaveMsg({ tone: 'ok', text: 'Alterações salvas.' })
      onChanged()
      await load()
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'EMAIL_ALREADY_IN_USE')   setSaveMsg({ tone: 'err', text: 'Email já em uso por outro usuário.' })
      else if (code === 'SELF_LOCKOUT_PROTECTED') setSaveMsg({ tone: 'err', text: 'Você não pode bloquear/despromover a si mesmo.' })
      else if (code === 'INSUFFICIENT_BALANCE')   setSaveMsg({ tone: 'err', text: 'Saldo insuficiente para o débito solicitado.' })
      else                                         setSaveMsg({ tone: 'err', text: 'Erro ao salvar. Verifique os campos.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-stretch justify-end" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] h-full bg-[#0f1117] border-l border-[#1f232e] flex flex-col shadow-2xl shadow-black/40"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e] flex-shrink-0">
          <h2 className="text-sm font-bold text-white">Editar Usuário</h2>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={18} /></button>
        </div>

        {loading || !data || !form ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#8b8f9a]">
            {error || 'Carregando…'}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
              {isSelf && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                  <AlertCircle size={13} className="text-orange-400 flex-shrink-0" />
                  <span className="text-[11px] text-[#ccc]">Esta é a sua conta. Cuidado ao alterar permissões.</span>
                </div>
              )}

              {/* ── Profile ─────────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome">
                  <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                </Field>
                <Field label="Sobrenome">
                  <Input value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} />
                </Field>
              </div>

              <Field label="Email">
                <Input value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="CPF">
                  <Input value={form.cpf} onChange={(v) => setForm({ ...form, cpf: v })} />
                </Field>
                <Field label="Telefone">
                  <Input value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Saldo (R$)">
                  <Input value={form.balance} onChange={(v) => setForm({ ...form, balance: numStr(v) })} inputMode="decimal" />
                </Field>
                <Field label="Bônus (R$)">
                  <Input value={form.bonusBalance} onChange={(v) => setForm({ ...form, bonusBalance: numStr(v) })} inputMode="decimal" />
                </Field>
              </div>

              {/* ── Rollover ────────────────────────────────────────── */}
              <Section title="Rollover do Bônus">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Requerido (R$)">
                    <Input value={form.rolloverRequired} onChange={(v) => setForm({ ...form, rolloverRequired: numStr(v) })} inputMode="decimal" />
                  </Field>
                  <Field label="Completado (R$)">
                    <Input value={form.rolloverProgress} onChange={(v) => setForm({ ...form, rolloverProgress: numStr(v) })} inputMode="decimal" />
                  </Field>
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-[#8b8f9a] mb-1">
                    <span>Progresso</span>
                    <span className="text-white font-semibold">{rolloverPct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#1a1e2a] overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${rolloverPct}%` }}
                    />
                  </div>
                </div>
              </Section>

              {/* ── Payout overrides ────────────────────────────────── */}
              <Section title="% Payout Personalizado" subtitle="Defina um payout fixo para este usuário em cada mercado. Quando ativo, sobrescreve o payout padrão do ativo.">
                <PayoutRow
                  label="Forex"
                  enabled={form.payoutForexEnabled}
                  value={form.payoutForexValue}
                  onEnabled={(e) => setForm({ ...form, payoutForexEnabled: e })}
                  onValue={(v) => setForm({ ...form, payoutForexValue: numStr(v) })}
                />
                <PayoutRow
                  label="OTC"
                  enabled={form.payoutOtcEnabled}
                  value={form.payoutOtcValue}
                  onEnabled={(e) => setForm({ ...form, payoutOtcEnabled: e })}
                  onValue={(v) => setForm({ ...form, payoutOtcValue: numStr(v) })}
                />
                <PayoutRow
                  label="Cripto"
                  enabled={form.payoutCryptoEnabled}
                  value={form.payoutCryptoValue}
                  onEnabled={(e) => setForm({ ...form, payoutCryptoEnabled: e })}
                  onValue={(v) => setForm({ ...form, payoutCryptoValue: numStr(v) })}
                />
              </Section>

              {/* ── Market permissions ──────────────────────────────── */}
              <Section title="Permissões de Mercado">
                <ToggleRow label="Mercado Aberto (Forex)" value={form.canTradeForex}  onChange={(v) => setForm({ ...form, canTradeForex: v })} />
                <ToggleRow label="OTC"                    value={form.canTradeOtc}    onChange={(v) => setForm({ ...form, canTradeOtc: v })} />
                <ToggleRow label="Cripto"                 value={form.canTradeCrypto} onChange={(v) => setForm({ ...form, canTradeCrypto: v })} />
              </Section>

              {/* ── User-state toggles ──────────────────────────────── */}
              <div className="flex flex-col gap-3 pt-2 border-t border-[#1f232e]">
                <ToggleRow label="Copy Trader"   value={form.copyTraderEnabled} onChange={(v) => setForm({ ...form, copyTraderEnabled: v })} />
                <ToggleRow label="Usuário Fake"  value={form.isFake}            onChange={(v) => setForm({ ...form, isFake: v })} />
                <ToggleRow label="Bloqueado"     value={form.blocked}           onChange={(v) => setForm({ ...form, blocked: v })} disabled={isSelf} />
              </div>

              {/* ── Reset password ──────────────────────────────────── */}
              <button
                onClick={() => setResetOpen(true)}
                className="flex items-center gap-2 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors w-fit"
              >
                <KeyRound size={13} /> Redefinir Senha
              </button>
            </div>

            {/* Footer with save */}
            <div className="border-t border-[#1f232e] px-5 py-3 flex items-center gap-3 flex-shrink-0">
              {saveMsg && (
                <span className={cn(
                  'text-[11px] font-semibold',
                  saveMsg.tone === 'ok' ? 'text-emerald-400' : 'text-red-400',
                )}>
                  {saveMsg.text}
                </span>
              )}
              <button
                onClick={onClose}
                className="ml-auto h-9 px-4 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="h-9 px-5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-black transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                Salvar alterações
              </button>
            </div>
          </>
        )}

        {resetOpen && data && (
          <ResetPasswordModal
            userId={data.user.id}
            email={data.user.email}
            onClose={() => setResetOpen(false)}
          />
        )}
      </aside>
    </div>
  )
}

// ── Form state helpers ────────────────────────────────────────────────────

interface EditState {
  name:                  string
  lastName:              string
  email:                 string
  cpf:                   string
  phone:                 string
  balance:               string
  bonusBalance:          string
  rolloverRequired:      string
  rolloverProgress:      string
  payoutForexEnabled:    boolean
  payoutForexValue:      string
  payoutOtcEnabled:      boolean
  payoutOtcValue:        string
  payoutCryptoEnabled:   boolean
  payoutCryptoValue:     string
  canTradeForex:         boolean
  canTradeOtc:           boolean
  canTradeCrypto:        boolean
  copyTraderEnabled:     boolean
  isFake:                boolean
  blocked:               boolean
}

function toFormState(d: UserDetail): EditState {
  const real = d.accounts.find((a) => a.type === 'REAL')
  return {
    name:                  d.user.name ?? '',
    lastName:              d.user.lastName ?? '',
    email:                 d.user.email ?? '',
    cpf:                   d.user.cpf ?? '',
    phone:                 d.user.phone ?? '',
    balance:               real ? parseFloat(real.balance).toString() : '0',
    bonusBalance:          real ? parseFloat(real.bonusBalance).toString() : '0',
    rolloverRequired:      real ? parseFloat(real.rolloverRequired).toString() : '0',
    rolloverProgress:      real ? parseFloat(real.rolloverProgress).toString() : '0',
    payoutForexEnabled:    d.user.payoutOverrideForex   != null,
    payoutForexValue:      d.user.payoutOverrideForex   != null ? String(d.user.payoutOverrideForex)   : '85',
    payoutOtcEnabled:      d.user.payoutOverrideOtc     != null,
    payoutOtcValue:        d.user.payoutOverrideOtc     != null ? String(d.user.payoutOverrideOtc)     : '85',
    payoutCryptoEnabled:   d.user.payoutOverrideCrypto  != null,
    payoutCryptoValue:     d.user.payoutOverrideCrypto  != null ? String(d.user.payoutOverrideCrypto)  : '85',
    canTradeForex:         d.user.canTradeForex,
    canTradeOtc:           d.user.canTradeOtc,
    canTradeCrypto:        d.user.canTradeCrypto,
    copyTraderEnabled:     d.user.copyTraderEnabled,
    isFake:                d.user.isFake,
    blocked:               d.user.blocked,
  }
}

function numStr(s: string): string {
  // Accept digits + decimal separator, normalize comma → dot.
  return s.replace(/[^0-9.,]/g, '').replace(',', '.')
}

function toIntOrNull(s: string): number | null {
  const n = parseInt(s, 10)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-white mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 pt-3 border-t border-[#1f232e]">
      <div>
        <h3 className="text-xs font-bold text-white">{title}</h3>
        {subtitle && <p className="text-[10px] text-[#8b8f9a] mt-0.5 leading-snug">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Input({ value, onChange, type, inputMode }: {
  value: string
  onChange: (v: string) => void
  type?: string
  inputMode?: 'decimal' | 'numeric'
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={type ?? 'text'}
      inputMode={inputMode}
      className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 text-xs text-white outline-none focus:border-emerald-500/60 placeholder-[#8b8f9a]"
    />
  )
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  // Geometry: button 40px wide × 20px tall (w-10 h-5). Knob 16px × 16px
  // (w-4 h-4) absolutely positioned with explicit left-0.5 / top-0.5
  // (2px inset on both sides). When ON, translate-x-5 (20px) puts the
  // knob's left edge at 22px → right edge at 38px → still 2px gap from
  // the button's right edge. The previous version relied on implicit
  // `left: auto` + translate-x-[22px], which rendered the knob outside
  // the pill in some browser/layout combos. type="button" prevents
  // form-submit if a parent ever wraps these in a <form>.
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={cn(
        'w-10 h-5 rounded-full relative transition-colors flex-shrink-0',
        value ? 'bg-emerald-500' : 'bg-[#2a2e3b]',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
          value ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}

function ToggleRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn('text-xs', disabled ? 'text-[#5d6275]' : 'text-white')}>{label}</span>
      <Toggle value={value} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function PayoutRow({ label, enabled, value, onEnabled, onValue }: {
  label:     string
  enabled:   boolean
  value:     string
  onEnabled: (v: boolean) => void
  onValue:   (v: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <Toggle value={enabled} onChange={onEnabled} />
      <span className="text-xs text-white w-16">{label}</span>
      <div className="flex-1 relative">
        <input
          value={value}
          onChange={(e) => onValue(e.target.value.replace(/[^0-9]/g, ''))}
          disabled={!enabled}
          inputMode="numeric"
          placeholder="85"
          className={cn(
            'w-full h-8 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 pr-7 text-xs text-right outline-none focus:border-emerald-500/60',
            enabled ? 'text-white' : 'text-[#5d6275]',
          )}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#8b8f9a]">%</span>
      </div>
    </div>
  )
}

// ── Reset password modal ──────────────────────────────────────────────────

function ResetPasswordModal({ userId, email, onClose }: { userId: string; email: string; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)

  async function submit() {
    if (password.length < 6) { setError('Senha precisa ter pelo menos 6 caracteres.'); return }
    setLoading(true); setError('')
    try {
      await api.post(`/admin/users/${userId}/reset-password`, { newPassword: password })
      setDone(true)
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'PASSWORD_TOO_SHORT') setError('Senha muito curta.')
      else                                setError('Erro ao redefinir senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-[400px] bg-[#13161f] border border-[#1f232e] rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f232e]">
          <h3 className="text-sm font-bold text-white">Redefinir Senha</h3>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={14} /></button>
        </div>
        <div className="p-4">
          {done ? (
            <>
              <div className="px-3 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 mb-3">
                <p className="text-xs text-emerald-300 leading-relaxed">
                  Senha redefinida com sucesso. Comunique a nova senha ao usuário por canal seguro (WhatsApp, email).
                </p>
              </div>
              <button onClick={onClose} className="w-full h-9 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-black">
                Fechar
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-[#ccc] leading-relaxed mb-3">
                Definir nova senha para <strong className="text-white">{email}</strong>. O usuário poderá entrar com essa senha imediatamente.
              </p>
              <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Nova senha (mínimo 6 caracteres)</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="text"
                placeholder="••••••"
                className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60 mb-3 font-mono"
              />
              {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white">Cancelar</button>
                <button onClick={submit} disabled={loading} className="flex-1 h-9 rounded-lg bg-blue-500 hover:bg-blue-400 text-xs font-bold text-white disabled:opacity-50">
                  {loading ? '...' : 'Redefinir'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
