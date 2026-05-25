'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Copy, Check, AlertCircle, CheckCircle2, Clock, Loader2, Zap, ShieldCheck, BadgeCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'

interface DepositoModalProps {
  onClose: () => void
}

interface CreatedDeposit {
  id:        string
  amount:    string
  status:    string
  qrcode:    string
  createdAt: string
}

const MIN = 60        // R$ — kept in sync with apps/api/src/deposits/schema.ts
const MAX = 10_000    // R$
const POLL_MS = 3000  // status poll interval while QR is on screen
const PRESETS = [60, 100, 250, 500, 1000]
const POPULAR_VALUE = 250   // gets the "Mais escolhido" highlight

type Phase = 'form' | 'qrcode' | 'paid' | 'expired'

export function DepositoModal({ onClose }: DepositoModalProps) {
  const authStore = useAuthStore()

  const [phase, setPhase]     = useState<Phase>('form')
  const [amount, setAmount]   = useState<string>('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [deposit, setDeposit] = useState<CreatedDeposit | null>(null)
  const [copied, setCopied]   = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const amountNum = parseFloat(amount.replace(',', '.')) || 0
  const valid     = amountNum >= MIN && amountNum <= MAX

  // Status polling while we're showing the QR — stops on resolution or unmount.
  useEffect(() => {
    if (phase !== 'qrcode' || !deposit) return
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/deposits/${deposit.id}`)
        const status   = data?.deposit?.status
        if (status === 'PAID') {
          setPhase('paid')
          // Optimistically bump balance in store so the header updates without a hard reload.
          const u  = authStore.user
          const ra = u?.accounts.find((a) => a.type === 'REAL')
          if (u && ra) authStore.applyBalanceDelta(ra.id, amountNum)
        } else if (status === 'FAILED' || status === 'CANCELLED') {
          setPhase('expired')
        }
      } catch { /* network blip — keep polling */ }
    }, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deposit?.id])

  async function submit() {
    if (!valid || loading) return
    setLoading(true); setError('')
    try {
      const { data } = await api.post<{ deposit: CreatedDeposit }>('/deposits/pix', { amount: amountNum })
      setDeposit(data.deposit)
      setPhase('qrcode')
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'PAYMENT_GATEWAY_UNAVAILABLE') setError('Pagamentos indisponíveis no momento. Tente mais tarde.')
      else if (code === 'PAYMENT_GATEWAY_ERROR')       setError('Erro no provedor de pagamento. Tente novamente em instantes.')
      else if (code === 'VALIDATION_ERROR')            setError(`Valor inválido. Mínimo R$ ${MIN}, máximo R$ ${MAX}.`)
      else if (code === 'ACCOUNT_NOT_FOUND')           setError('Sua conta real não foi encontrada.')
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
    } catch { /* clipboard blocked — ignore */ }
  }

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // Soft brand glow via layered shadows; subtle gradient inside the body.
          'relative w-full max-w-[480px] flex flex-col max-h-[92vh]',
          'rounded-2xl border border-white/5 overflow-hidden',
          'bg-gradient-to-b from-[#1c2032] to-[#15182a]',
          'shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7),0_0_0_1px_rgba(50,188,173,0.05),0_-1px_60px_-20px_rgba(50,188,173,0.25)]',
        )}
      >
        {/* PIX brand accent strip at the very top */}
        <div className="h-[3px] w-full bg-gradient-to-r from-[#32BCAD] via-[#3ad4c1] to-[#32BCAD]" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-[#32BCAD]/40 blur-md" aria-hidden="true" />
              <PixIcon size={28} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-white leading-tight">Depósito via PIX</h2>
              <p className="text-[11px] text-[#7c8195] leading-tight mt-0.5">Crédito instantâneo · Sem taxas</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          {phase === 'form'    && <FormStep
                                     amount={amount} setAmount={setAmount}
                                     valid={valid} amountNum={amountNum}
                                     submit={submit} loading={loading} error={error}
                                   />}
          {phase === 'qrcode'  && deposit && <QrStep
                                     deposit={deposit} amountNum={amountNum}
                                     copied={copied} onCopy={copy}
                                     onCancel={onClose}
                                   />}
          {phase === 'paid'    && <PaidStep amount={amountNum} onClose={onClose} />}
          {phase === 'expired' && <ExpiredStep onRetry={() => { setPhase('form'); setDeposit(null) }} />}
        </div>
      </div>
    </div>
  )
}

// ── Steps ───────────────────────────────────────────────────────────────────

function FormStep({
  amount, setAmount, valid, amountNum, submit, loading, error,
}: {
  amount: string; setAmount: (v: string) => void; valid: boolean; amountNum: number
  submit: () => void; loading: boolean; error: string
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Presets — bigger, with "Mais escolhido" highlight on R$ 250 */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b8f9a] mb-2 px-0.5 uppercase tracking-wider">
          Valor sugerido
        </label>
        <div className="grid grid-cols-5 gap-2">
          {PRESETS.map((v) => {
            const selected = amountNum === v
            const popular  = v === POPULAR_VALUE
            return (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className={cn(
                  'relative h-11 rounded-lg text-[13px] font-bold border transition-all duration-150',
                  selected
                    ? 'bg-emerald-500/15 border-emerald-400/60 text-emerald-300 shadow-[0_0_0_3px_rgba(16,185,129,0.08)]'
                    : 'bg-[#222637] border-[#2a2e3b] text-[#bdc1cf] hover:text-white hover:border-[#3a4055] hover:bg-[#262b3e]',
                )}
              >
                {popular && !selected && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-[1px] rounded text-[8px] font-bold uppercase tracking-wider bg-[#32BCAD] text-white shadow-sm whitespace-nowrap">
                    Top
                  </span>
                )}
                R$ {v}
              </button>
            )
          })}
        </div>
      </div>

      {/* Amount field with R$ prefix inside */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b8f9a] mb-2 px-0.5 uppercase tracking-wider">
          Valor personalizado
        </label>
        <div className={cn(
          'relative flex items-center rounded-xl border transition-colors',
          'bg-[#222637]',
          valid
            ? 'border-emerald-500/40 shadow-[0_0_0_3px_rgba(16,185,129,0.05)]'
            : amount
              ? 'border-amber-500/40'
              : 'border-[#2a2e3b] focus-within:border-[#32BCAD]/60',
        )}>
          <span className="pl-4 pr-1 text-base font-semibold text-[#7c8195] select-none">R$</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder="0,00"
            className="flex-1 bg-transparent py-3.5 pr-4 text-lg font-bold text-white outline-none placeholder:text-[#4d5266] placeholder:font-normal"
          />
        </div>
        <p className="text-[10px] text-[#7c8195] mt-1.5 px-0.5">
          Mínimo R$ {MIN.toLocaleString('pt-BR')} · Máximo R$ {MAX.toLocaleString('pt-BR')}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-red-300">{error}</span>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!valid || loading}
        className={cn(
          'group relative w-full h-12 rounded-xl text-sm font-bold text-white transition-all duration-200',
          'flex items-center justify-center gap-2 overflow-hidden',
          valid && !loading
            ? 'bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[0_4px_20px_-4px_rgba(59,130,246,0.6)] hover:shadow-[0_6px_24px_-2px_rgba(59,130,246,0.7)] hover:-translate-y-px active:translate-y-0'
            : 'bg-[#2a2e3b] text-[#5d6275] cursor-not-allowed',
        )}
      >
        {/* Shine sweep on hover when active */}
        {valid && !loading && (
          <span className="absolute inset-y-0 -left-12 w-12 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 transition-transform duration-700 group-hover:translate-x-[600%]" aria-hidden="true" />
        )}
        {loading
          ? (<><Loader2 size={14} className="animate-spin" /> Gerando QR…</>)
          : valid
            ? `Gerar QR Code · R$ ${amountNum.toFixed(2).replace('.', ',')}`
            : 'Gerar QR Code'}
      </button>

      {/* Trust signals */}
      <div className="flex items-center justify-center gap-4 pt-1">
        <TrustChip icon={<Zap         size={12} />} label="Instantâneo" />
        <TrustChip icon={<ShieldCheck size={12} />} label="Seguro" />
        <TrustChip icon={<BadgeCheck  size={12} />} label="PIX oficial" />
      </div>
    </div>
  )
}

function TrustChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#7c8195]">
      <span className="text-[#32BCAD]">{icon}</span>
      {label}
    </span>
  )
}

function QrStep({
  deposit, amountNum, copied, onCopy, onCancel,
}: {
  deposit: CreatedDeposit; amountNum: number
  copied: boolean; onCopy: () => void; onCancel: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      {/* Amount card up top */}
      <div className="w-full rounded-xl bg-[#222637] border border-[#2a2e3b] px-4 py-3 flex items-baseline justify-between">
        <span className="text-[11px] text-[#7c8195] uppercase tracking-wider font-semibold">Valor a pagar</span>
        <span className="text-xl font-bold text-white tabular-nums">R$ {amountNum.toFixed(2).replace('.', ',')}</span>
      </div>

      {/* QR with brand-color glow frame */}
      <div className="relative">
        <div className="absolute inset-0 rounded-2xl bg-[#32BCAD]/20 blur-xl" aria-hidden="true" />
        <div className="relative bg-white p-3.5 rounded-2xl border-2 border-[#32BCAD]/30">
          <QRCodeSVG value={deposit.qrcode} size={196} level="M" />
        </div>
      </div>

      {/* Status pill */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
        <span className="text-xs font-semibold text-amber-300">Aguardando pagamento</span>
      </div>

      {/* Copy button */}
      <button
        onClick={onCopy}
        className={cn(
          'w-full h-11 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2',
          copied
            ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
            : 'bg-[#222637] border-[#2a2e3b] text-white hover:border-[#32BCAD]/50 hover:bg-[#262b3e]',
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

      <button
        onClick={onCancel}
        className="text-[11px] text-[#7c8195] hover:text-white transition-colors"
      >
        Cancelar e fechar
      </button>
    </div>
  )
}

function PaidStep({ amount, onClose }: { amount: number; onClose: () => void }) {
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
        <span className="text-emerald-300 font-bold">R$ {amount.toFixed(2).replace('.', ',')}</span> creditado na sua conta real.
      </p>
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
        className="mt-3 w-full h-11 rounded-xl bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-sm font-bold text-white shadow-[0_4px_20px_-4px_rgba(59,130,246,0.6)] hover:-translate-y-px transition-transform"
      >
        Tentar novamente
      </button>
    </div>
  )
}

// ── PIX brand mark — official Banco Central symbol ────────────────────────
// 4 rounded squares rotated 45° form the canonical PIX rhombus with an
// X-shaped gap in the middle. Matches the BCB brand guidelines (turquoise
// #32BCAD, no background circle, 4 quadrants separated by ~2px gap).
function PixIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="relative" aria-label="PIX">
      <g transform="rotate(45 16 16)" fill="#32BCAD">
        <rect x="7"  y="7"  width="8" height="8" rx="1.5" />
        <rect x="17" y="7"  width="8" height="8" rx="1.5" />
        <rect x="7"  y="17" width="8" height="8" rx="1.5" />
        <rect x="17" y="17" width="8" height="8" rx="1.5" />
      </g>
    </svg>
  )
}
