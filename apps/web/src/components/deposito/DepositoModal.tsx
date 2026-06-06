'use client'

import { useEffect, useRef, useState } from 'react'
import {
  X, Copy, Check, AlertCircle, CheckCircle2, Clock, Loader2,
  Banknote, Gift, QrCode, ChevronDown,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '@/lib/api'
import { useAuthStore, SETTINGS_FALLBACK } from '@/store/auth'
import { cn } from '@/lib/utils'

interface DepositoModalProps {
  onClose: () => void
  // Optional bonus code to apply on mount (e.g., user clicked "Depositar"
  // on a card in the BonusPanel). When provided, the manual input is
  // pre-filled and the dropdown selection is synced; validation fires as
  // soon as the user enters a deposit amount.
  initialBonusCode?: string
  /** Pai abre o UsdtDepositoModal. Quando set, mostra link "Pagar com USDT". */
  onSwitchToUsdt?: () => void
}

interface CreatedDeposit {
  id:        string
  amount:    string
  status:    string
  qrcode:    string
  createdAt: string
}

// Mirror of apps/api/src/bonuses/service.ts ValidatedBonus.
interface ValidatedBonus {
  id:               string
  code:             string
  type:             'PERCENTAGE' | 'FIXED'
  value:            number
  minDeposit:       number
  rollover:         number
  bonusAmount:      number
  rolloverRequired: number
}

interface AvailableBonus {
  id:         string
  code:       string
  type:       'PERCENTAGE' | 'FIXED'
  value:      number
  minDeposit: number
  rollover:   number
}

// MIN/MAX now live in PlatformSettings (admin: /admin/configuracoes) and
// flow to the client via /auth/me → authStore.settings. SETTINGS_FALLBACK
// covers the brief window before /auth/me lands.
const POLL_MS = 3000
const PRESETS = [100, 250, 500, 1000, 2500, 5000]

type Phase = 'form' | 'qrcode' | 'paid' | 'expired'

function bonusErrorLabel(code: string): string {
  switch (code) {
    case 'NOT_FOUND':             return 'Código não encontrado.'
    case 'INACTIVE':              return 'Este código não está mais ativo.'
    case 'EXPIRED':               return 'Este código expirou.'
    case 'BELOW_MIN':             return 'Depósito abaixo do mínimo exigido pelo código.'
    case 'USER_HAS_OPEN_GRANT':   return 'Você já tem um bônus ativo. Complete o rollover antes de usar outro.'
    case 'USER_MAX_USES_REACHED': return 'Você já usou este código o máximo de vezes permitido.'
    default:                       return 'Código inválido.'
  }
}

// CPF mask helpers — display 000.000.000-00, storage = 11 digits only.
function maskCpf(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3)  return d
  if (d.length <= 6)  return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9)  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return                       `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}
function unmaskCpf(masked: string): string {
  return masked.replace(/\D/g, '').slice(0, 11)
}

function formatBrl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function DepositoModal({ onClose, initialBonusCode, onSwitchToUsdt }: DepositoModalProps) {
  const authStore = useAuthStore()
  const profileCpf = authStore.user?.cpf ?? null
  // Pull deposit min/max from admin-edited PlatformSettings (lands in
  // authStore via /auth/me). Falls back to the historical defaults if
  // /auth/me hasn't resolved yet — same numbers the migration seeded.
  const MIN = authStore.settings?.depositMin ?? SETTINGS_FALLBACK.depositMin
  const MAX = authStore.settings?.depositMax ?? SETTINGS_FALLBACK.depositMax

  const [phase, setPhase]     = useState<Phase>('form')
  // When initialBonusCode is set, seed the amount at R$ 100 in initial
  // state (not in an effect post-fetch). That lets the bonus-validate
  // call fire IN PARALLEL with /bonuses/available — user sees the
  // "Você ganha R$ X em bônus" preview in ~one round-trip instead of
  // waiting sequentially for both fetches. If the bonus has a higher
  // minDeposit, the available-list handler below bumps it + re-validates.
  const [amount, setAmount]   = useState<string>(initialBonusCode ? '100' : '')
  const [cpfDigits, setCpfDigits] = useState<string>(profileCpf ?? '')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [deposit, setDeposit] = useState<CreatedDeposit | null>(null)
  const [copied, setCopied]   = useState(false)

  // Bonus state — entry can come from dropdown selection or manual input
  // followed by Aplicar click. initialBonusCode pre-fills both.
  const [availableBonuses, setAvailableBonuses] = useState<AvailableBonus[]>([])
  const [selectedDropdown, setSelectedDropdown] = useState<string>('')   // bonus.id
  const [bonusInput,       setBonusInput]       = useState<string>(initialBonusCode ?? '')   // manual entry
  const [bonusInfo,        setBonusInfo]        = useState<ValidatedBonus | null>(null)
  const [bonusError,       setBonusError]       = useState('')
  const [validatingBonus,  setValidatingBonus]  = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const amountNum = parseFloat(amount.replace(',', '.')) || 0
  const validAmount = amountNum >= MIN && amountNum <= MAX
  const validCpf    = cpfDigits.length === 11
  const canSubmit   = validAmount && validCpf && !loading

  // Fetch available bonuses once on open. When initialBonusCode is set,
  // also: (1) sync the dropdown to the matching option, (2) pre-fill the
  // amount with max(100, bonus.minDeposit) so the bonus passes validation
  // out of the gate — user can edit it down (validation will then warn
  // they're below the bonus minimum). User flow: click "Depositar agora"
  // on a bonus card → modal opens with everything ready to confirm.
  useEffect(() => {
    let cancelled = false
    api.get<{ bonuses: AvailableBonus[] }>('/bonuses/available')
      .then(({ data }) => {
        if (cancelled) return
        setAvailableBonuses(data.bonuses)
        if (initialBonusCode) {
          const match = data.bonuses.find(b => b.code === initialBonusCode.toUpperCase())
          if (match) {
            setSelectedDropdown(match.id)
            // Bump amount up to the bonus minDeposit if our initial guess
            // of 100 was too low. We compare against the LIVE state of
            // `amount` via a functional updater so we don't accidentally
            // overwrite a value the user typed in the brief window between
            // mount and this fetch resolving.
            setAmount((prev) => {
              const current = parseFloat(prev.replace(',', '.')) || 0
              const min = Math.max(100, match.minDeposit)
              return current < min ? String(min) : prev
            })
          }
          // Unknown code path: amount is already '100' from initial state,
          // validation will simply fail downstream — nothing extra to do.
        }
      })
      .catch(() => { /* dropdown stays empty — user can still type code manually */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // If we have an initial code AND the user enters a valid amount, kick off
  // validation automatically so the preview appears without an extra click.
  useEffect(() => {
    if (!initialBonusCode || bonusInfo || !validAmount) return
    void applyBonusCode(initialBonusCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validAmount])

  function removeBonus() {
    setBonusInput('')
    setBonusInfo(null)
    setBonusError('')
    setSelectedDropdown('')
  }

  // Re-validate bonus when amount changes IF a code was already applied
  // (avoids stale "Você ganha R$ X" preview while user adjusts amount).
  useEffect(() => {
    if (!bonusInfo) return
    if (!validAmount) { setBonusInfo(null); return }
    void applyBonusCode(bonusInfo.code, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountNum])

  // Status polling while showing QR.
  useEffect(() => {
    if (phase !== 'qrcode' || !deposit) return
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/deposits/${deposit.id}`)
        const status   = data?.deposit?.status
        if (status === 'PAID') {
          setPhase('paid')
          const u  = authStore.user
          const ra = u?.accounts.find((a) => a.type === 'REAL')
          if (u && ra) authStore.applyBalanceDelta(ra.id, amountNum)
        } else if (status === 'FAILED' || status === 'CANCELLED') {
          setPhase('expired')
        }
      } catch { /* keep polling */ }
    }, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deposit?.id])

  async function applyBonusCode(code: string, silent = false) {
    if (!code.trim()) { setBonusInfo(null); setBonusError(''); return }
    if (!validAmount) {
      if (!silent) setBonusError('Digite o valor do depósito primeiro.')
      return
    }
    setValidatingBonus(true); setBonusError('')
    try {
      const { data } = await api.post<{ bonus: ValidatedBonus }>(
        '/bonuses/validate',
        { code: code.trim(), depositAmount: amountNum },
      )
      setBonusInfo(data.bonus)
    } catch (err: any) {
      const errCode = err?.response?.data?.error ?? 'NOT_FOUND'
      setBonusInfo(null)
      setBonusError(bonusErrorLabel(errCode))
    } finally {
      setValidatingBonus(false)
    }
  }

  function onDropdownChange(id: string) {
    setSelectedDropdown(id)
    const picked = availableBonuses.find(b => b.id === id)
    if (!picked) { setBonusInput(''); setBonusInfo(null); setBonusError(''); return }
    setBonusInput(picked.code)
    void applyBonusCode(picked.code)
  }

  async function submit() {
    if (!canSubmit) return
    if (bonusInput.trim() && !bonusInfo) {
      setError('Verifique o código de bônus ou remova-o antes de continuar.')
      return
    }
    setLoading(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        amount: amountNum,
        cpf:    cpfDigits,
      }
      if (bonusInput.trim() && bonusInfo) payload.bonusCode = bonusInput.trim()
      const { data } = await api.post<{ deposit: CreatedDeposit }>('/deposits/pix', payload)
      setDeposit(data.deposit)
      setPhase('qrcode')
    } catch (err: any) {
      const code = err?.response?.data?.error ?? ''
      if      (code === 'PAYMENT_GATEWAY_UNAVAILABLE') setError('Pagamentos indisponíveis no momento. Tente mais tarde.')
      else if (code === 'PAYMENT_GATEWAY_ERROR')       setError('Erro no provedor de pagamento. Tente novamente em instantes.')
      else if (code === 'VALIDATION_ERROR')            setError('Dados inválidos. Verifique o valor e o CPF.')
      else if (code === 'ACCOUNT_NOT_FOUND')           setError('Sua conta real não foi encontrada.')
      else if (code.startsWith('BONUS_'))              setError(bonusErrorLabel(code.replace('BONUS_', '')))
      else                                              setError('Erro ao gerar QR. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    if (!deposit) return
    try {
      await navigator.clipboard.writeText(deposit.qrcode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked */ }
  }

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative w-full max-w-[460px] flex flex-col max-h-[92vh]',
          'rounded-2xl border border-[#2a2e3b] overflow-hidden',
          'bg-[#161827]',
          'shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]',
        )}
      >
        {/* Header — icone + titulo + close */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <Banknote size={20} className="text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-white leading-tight">Depósito</h2>
            <p className="text-[11px] text-[#7c8195] leading-tight mt-0.5">
              Escolha o método e faça seu depósito
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors flex-shrink-0"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cards de metodo — PIX (ativo) + USDT (switch) */}
        {phase === 'form' && onSwitchToUsdt && (
          <div className="px-5 pb-3 grid grid-cols-2 gap-3 flex-shrink-0">
            {/* PIX card — ATIVO */}
            <div className="rounded-xl border-2 border-emerald-500/60 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 px-3 py-3 shadow-[0_4px_16px_-4px_rgba(16,185,129,0.3)]">
              <div className="flex items-center gap-2.5">
                <PixLogo size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white leading-tight">PIX</div>
                  <div className="text-[10px] text-emerald-300 leading-tight mt-0.5">Depósito instantâneo</div>
                </div>
              </div>
              <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[9px] font-bold text-emerald-300 uppercase tracking-wide">
                Recomendado
              </div>
            </div>
            {/* USDT card — switch */}
            <button
              onClick={onSwitchToUsdt}
              className="rounded-xl border-2 border-[#2a2e3b] bg-[#1a1e2a] px-3 py-3 hover:border-emerald-500/40 hover:bg-[#1d2130] transition-all text-left group"
            >
              <div className="flex items-center gap-2.5">
                <TetherLogo size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white leading-tight">USDT</div>
                  <div className="text-[10px] text-[#7c8195] leading-tight mt-0.5">Transferência via rede</div>
                </div>
              </div>
              <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-[9px] font-bold text-blue-300 uppercase tracking-wide">
                Rede: Tron
              </div>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4">
          {phase === 'form'    && <FormStep
                                     amount={amount} setAmount={setAmount}
                                     validAmount={validAmount} amountNum={amountNum}
                                     cpfDigits={cpfDigits} setCpfDigits={setCpfDigits}
                                     profileCpf={profileCpf}
                                     submit={submit} canSubmit={canSubmit}
                                     loading={loading} error={error}
                                     availableBonuses={availableBonuses}
                                     selectedDropdown={selectedDropdown} onDropdownChange={onDropdownChange}
                                     bonusInput={bonusInput} setBonusInput={setBonusInput}
                                     bonusInfo={bonusInfo} bonusError={bonusError}
                                     validatingBonus={validatingBonus}
                                     onApplyManual={() => applyBonusCode(bonusInput)}
                                     onRemoveBonus={removeBonus}
                                     min={MIN} max={MAX}
                                   />}
          {phase === 'qrcode'  && deposit && <QrStep
                                     deposit={deposit} amountNum={amountNum}
                                     copied={copied} onCopy={copy}
                                     onCancel={onClose}
                                   />}
          {phase === 'paid'    && <PaidStep amount={amountNum} bonusInfo={bonusInfo} onClose={onClose} />}
          {phase === 'expired' && <ExpiredStep onRetry={() => { setPhase('form'); setDeposit(null) }} />}
        </div>
      </div>
    </div>
  )
}

// ── Form step ──────────────────────────────────────────────────────────────

interface FormStepProps {
  amount: string; setAmount: (v: string) => void
  validAmount: boolean; amountNum: number
  cpfDigits: string; setCpfDigits: (v: string) => void
  profileCpf: string | null
  submit: () => void; canSubmit: boolean
  loading: boolean; error: string
  availableBonuses: AvailableBonus[]
  selectedDropdown: string; onDropdownChange: (id: string) => void
  bonusInput: string; setBonusInput: (v: string) => void
  bonusInfo: ValidatedBonus | null; bonusError: string
  validatingBonus: boolean
  onApplyManual: () => void
  onRemoveBonus: () => void
  // Admin-editable deposit limits forwarded from parent so the info bar
  // and the implicit min/max validation stay in sync with PlatformSettings.
  min: number
  max: number
}

function FormStep({
  amount, setAmount, validAmount, amountNum,
  cpfDigits, setCpfDigits, profileCpf,
  submit, canSubmit, loading, error,
  availableBonuses, selectedDropdown, onDropdownChange,
  bonusInput, setBonusInput, bonusInfo, bonusError, validatingBonus,
  onApplyManual, onRemoveBonus,
  min, max,
}: FormStepProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Valor do depósito */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <label className="text-[11px] font-bold text-[#bdc1cf] uppercase tracking-wide">Valor do depósito</label>
          <span className="text-[10px] text-[#7c8195]">
            Mín R$ {formatBrl(min)} · Máx R$ {formatBrl(max)}
          </span>
        </div>
        <div className={cn(
          'relative flex items-center rounded-xl border-2 transition-colors mb-3',
          'bg-gradient-to-b from-[#1d2130] to-[#191c29]',
          validAmount
            ? 'border-emerald-500/50 shadow-[0_0_0_3px_rgba(16,185,129,0.06)]'
            : amount
              ? 'border-amber-500/40'
              : 'border-[#2a2e3b] focus-within:border-emerald-500/40',
        )}>
          <span className="pl-4 pr-1 text-base font-bold text-emerald-400/80 select-none">R$</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder="0,00"
            className="flex-1 bg-transparent py-3.5 pr-4 text-xl font-bold text-white outline-none placeholder:text-[#3d4256] placeholder:font-normal tracking-tight"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((v) => {
            const selected = amountNum === v
            return (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className={cn(
                  'h-10 rounded-lg text-[12px] font-bold border transition-all',
                  selected
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300 shadow-[0_2px_8px_-2px_rgba(16,185,129,0.4)]'
                    : 'bg-[#1d2130] border-[#2a2e3b] text-[#bdc1cf] hover:border-emerald-500/40 hover:text-white hover:-translate-y-px',
                )}
              >
                R$ {v}
              </button>
            )
          })}
        </div>
      </div>

      {/* CPF */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <label className="text-[11px] font-bold text-[#bdc1cf] uppercase tracking-wide">CPF do pagador</label>
          {cpfDigits.length === 11 && profileCpf === cpfDigits && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <Check size={10} /> cadastrado
            </span>
          )}
        </div>
        <input
          inputMode="numeric"
          value={maskCpf(cpfDigits)}
          onChange={(e) => setCpfDigits(unmaskCpf(e.target.value))}
          placeholder="000.000.000-00"
          className={cn(
            'w-full h-11 px-3.5 rounded-lg bg-[#1d2130] border text-sm font-mono text-white outline-none transition-colors',
            cpfDigits.length === 11
              ? 'border-emerald-500/40'
              : cpfDigits.length > 0
                ? 'border-amber-500/40'
                : 'border-[#2a2e3b] focus:border-emerald-500/40',
          )}
        />
        {cpfDigits.length > 0 && cpfDigits.length < 11 && (
          <p className="text-[10px] text-amber-400 mt-1.5">CPF deve ter 11 dígitos</p>
        )}
      </div>

      {/* Bonus */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Gift size={12} className="text-emerald-400" />
          <label className="text-[11px] font-bold text-[#bdc1cf] uppercase tracking-wide">
            Código de bônus <span className="text-[#5d6275] font-medium normal-case tracking-normal">(opcional)</span>
          </label>
        </div>

        {/* Dropdown of available codes */}
        <div className="relative mb-2">
          <select
            value={selectedDropdown}
            onChange={(e) => onDropdownChange(e.target.value)}
            disabled={availableBonuses.length === 0}
            className="w-full h-11 px-3 pr-9 rounded-lg bg-[#1d2130] border border-[#2a2e3b] text-sm text-white outline-none focus:border-emerald-500/40 appearance-none disabled:text-[#5d6275]"
          >
            <option value="">
              {availableBonuses.length === 0 ? 'Sem códigos disponíveis' : 'Selecione um código de bônus'}
            </option>
            {availableBonuses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.type === 'PERCENTAGE' ? `${b.value}%` : `R$${b.value}`} (mín R${b.minDeposit})
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7c8195] pointer-events-none" />
        </div>

        {/* Manual entry + Aplicar */}
        <div className="flex items-stretch gap-2">
          <input
            value={bonusInput}
            onChange={(e) => {
              setBonusInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase())
              // Clear preview when user starts typing fresh
              if (bonusInfo) {
                setBonusInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase())
              }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onApplyManual() } }}
            placeholder="Ou digite o código aqui"
            maxLength={32}
            className="flex-1 h-11 px-3 rounded-lg bg-[#1d2130] border border-[#2a2e3b] text-sm font-mono text-white outline-none focus:border-emerald-500/40 placeholder:text-[#4d5266] placeholder:font-sans"
          />
          <button
            type="button"
            onClick={onApplyManual}
            disabled={!bonusInput.trim() || validatingBonus}
            className="h-11 px-4 rounded-lg bg-[#2a2e3b] border border-[#2a2e3b] text-xs font-bold text-white hover:bg-[#343b4d] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {validatingBonus ? <Loader2 size={12} className="animate-spin" /> : null}
            Aplicar
          </button>
        </div>

        {/* Preview / error chip */}
        {bonusInfo && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/25 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Check size={13} className="text-emerald-400 flex-shrink-0" />
              <span className="text-[11px] text-white font-semibold truncate">
                Você ganha <span className="text-emerald-300">R$ {formatBrl(bonusInfo.bonusAmount)}</span> em bônus
              </span>
            </div>
            <button
              type="button"
              onClick={onRemoveBonus}
              className="text-[11px] font-semibold text-[#7c8195] hover:text-red-300 transition-colors flex-shrink-0"
            >
              Remover
            </button>
          </div>
        )}
        {bonusError && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
            <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-[11px] text-red-300">{bonusError}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-red-300">{error}</span>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={submit}
        disabled={!canSubmit || (!!bonusInput.trim() && !bonusInfo)}
        className={cn(
          'mt-1 w-full h-12 rounded-xl text-[13px] font-bold transition-all duration-200',
          'flex items-center justify-center gap-2',
          canSubmit && (!bonusInput.trim() || bonusInfo)
            ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.7)] hover:-translate-y-px hover:shadow-[0_10px_28px_-8px_rgba(16,185,129,0.8)] active:translate-y-0'
            : 'bg-[#1d2130] text-[#4d5266] border border-[#2a2e3b] cursor-not-allowed',
        )}
      >
        {loading
          ? (<><Loader2 size={14} className="animate-spin" /> Gerando QR Code…</>)
          : (<><QrCode size={15} /> Gerar QR Code PIX</>)}
      </button>
    </div>
  )
}

// ── QR / Paid / Expired steps ──────────────────────────────────────────────

function QrStep({
  deposit, amountNum, copied, onCopy, onCancel,
}: {
  deposit: CreatedDeposit; amountNum: number
  copied: boolean; onCopy: () => void; onCancel: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full rounded-xl bg-[#1d2130] border border-[#2a2e3b] px-4 py-3 flex items-baseline justify-between">
        <span className="text-[11px] text-[#7c8195] uppercase tracking-wider font-semibold">Valor a pagar</span>
        <span className="text-xl font-bold text-white tabular-nums">R$ {formatBrl(amountNum)}</span>
      </div>

      <div className="relative">
        <div className="absolute inset-0 rounded-2xl bg-emerald-500/15 blur-xl" aria-hidden="true" />
        <div className="relative bg-white p-3.5 rounded-2xl border-2 border-emerald-500/30">
          <QRCodeSVG value={deposit.qrcode} size={196} level="M" />
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
        <span className="text-xs font-semibold text-amber-300">Aguardando pagamento</span>
      </div>

      <button
        onClick={onCopy}
        className={cn(
          'w-full h-11 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2',
          copied
            ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
            : 'bg-[#1d2130] border-[#2a2e3b] text-white hover:border-emerald-500/40',
        )}
      >
        {copied
          ? (<><Check size={14} /> Código copiado!</>)
          : (<><Copy  size={14} /> Copiar PIX Copia-e-Cola</>)}
      </button>

      <p className="text-[11px] text-[#7c8195] text-center leading-relaxed">
        Após pagar, esta tela atualiza automaticamente.<br />
        Se houver erro, feche e gere outro QR.
      </p>

      <button onClick={onCancel} className="text-[11px] text-[#7c8195] hover:text-white transition-colors">
        Cancelar e fechar
      </button>
    </div>
  )
}

function PaidStep({ amount, bonusInfo, onClose }: {
  amount: number; bonusInfo: ValidatedBonus | null; onClose: () => void
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-5">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-2xl" aria-hidden="true" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400/25 to-emerald-500/15 border border-emerald-400/50 flex items-center justify-center">
          <CheckCircle2 size={32} className="text-emerald-300" strokeWidth={2.5} />
        </div>
      </div>
      <h3 className="text-lg font-bold text-white mt-1">Depósito confirmado</h3>
      <p className="text-sm text-[#bdc1cf]">
        <span className="text-emerald-300 font-bold">R$ {formatBrl(amount)}</span> creditado na sua conta real.
      </p>
      {bonusInfo && (
        <div className="w-full px-3 py-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/25 flex items-start gap-2 text-left">
          <Gift size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <div className="text-white font-semibold">
              +R$ {formatBrl(bonusInfo.bonusAmount)} em bônus aplicado
            </div>
            <div className="text-[#7c8195]">
              Rollover {bonusInfo.rollover}× — opere R$ {formatBrl(bonusInfo.rolloverRequired)} pra liberar saque
            </div>
          </div>
        </div>
      )}
      <button
        onClick={onClose}
        className="mt-3 w-full h-11 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 text-sm font-bold text-white shadow-[0_4px_20px_-4px_rgba(16,185,129,0.6)] hover:-translate-y-px transition-transform"
      >
        Começar a operar
      </button>
    </div>
  )
}

function ExpiredStep({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-5">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-red-500/25 blur-2xl" aria-hidden="true" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-red-400/20 to-red-500/15 border border-red-400/50 flex items-center justify-center">
          <Clock size={28} className="text-red-300" strokeWidth={2.5} />
        </div>
      </div>
      <h3 className="text-lg font-bold text-white mt-1">Não foi possível concluir</h3>
      <p className="text-sm text-[#bdc1cf]">
        O depósito falhou ou foi cancelado. Você pode tentar novamente.
      </p>
      <button
        onClick={onRetry}
        className="mt-3 w-full h-11 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 text-sm font-bold text-white shadow-[0_4px_20px_-4px_rgba(16,185,129,0.6)] hover:-translate-y-px transition-transform"
      >
        Tentar novamente
      </button>
    </div>
  )
}

// ── Logo helpers ─────────────────────────────────────────────────────────
// SVG inline pra evitar dependencia de assets/icons externos. Mesma palette
// emerald do app — PIX mantem 4 losangos clasicos, USDT mantem T-circular
// do Tether.

function PixLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 4 losangos posicionados em + */}
      <rect x="11" y="2"  width="10" height="10" rx="2" transform="rotate(45 16 7)"  fill="#34d399" opacity="0.95"/>
      <rect x="11" y="20" width="10" height="10" rx="2" transform="rotate(45 16 25)" fill="#34d399" opacity="0.95"/>
      <rect x="2"  y="11" width="10" height="10" rx="2" transform="rotate(45 7 16)"  fill="#10b981" opacity="0.85"/>
      <rect x="20" y="11" width="10" height="10" rx="2" transform="rotate(45 25 16)" fill="#10b981" opacity="0.85"/>
      <circle cx="16" cy="16" r="3.5" fill="#0e1116" />
    </svg>
  )
}

function TetherLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#059669" stroke="#10b981" strokeWidth="1"/>
      {/* "T" do Tether */}
      <rect x="8"  y="9"  width="16" height="3"  rx="0.5" fill="white"/>
      <rect x="14" y="9"  width="4"  height="14" rx="0.5" fill="white"/>
      {/* Linha horizontal no meio do T (dash do simbolo USDT) */}
      <rect x="11" y="14" width="10" height="2"  rx="0.5" fill="#059669"/>
    </svg>
  )
}
