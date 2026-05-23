'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Copy, Check, AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
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
      className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] bg-[#1a1e2e] border border-[#2a2e3b] rounded-2xl shadow-2xl flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b] flex-shrink-0">
          <div className="flex items-center gap-2">
            <PixIcon size={22} />
            <h2 className="text-sm font-bold text-white">Depósito via PIX</h2>
          </div>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5">
          {phase === 'form'   && <FormStep
                                    amount={amount} setAmount={setAmount}
                                    valid={valid} amountNum={amountNum}
                                    submit={submit} loading={loading} error={error}
                                  />}
          {phase === 'qrcode' && deposit && <QrStep
                                    deposit={deposit} amountNum={amountNum}
                                    copied={copied} onCopy={copy}
                                    onCancel={onClose}
                                  />}
          {phase === 'paid'   && <PaidStep amount={amountNum} onClose={onClose} />}
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
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[#ccc] leading-relaxed">
        Selecione um valor abaixo ou digite no campo. O depósito é creditado
        automaticamente após o pagamento confirmar.
      </p>

      {/* Presets */}
      <div className="grid grid-cols-5 gap-2">
        {PRESETS.map((v) => (
          <button
            key={v}
            onClick={() => setAmount(String(v))}
            className={cn(
              'h-9 rounded-lg text-xs font-bold border transition-colors',
              amountNum === v
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400'
                : 'bg-[#252a3a] border-[#2a2e3b] text-[#8b8f9a] hover:text-white'
            )}
          >
            R$ {v}
          </button>
        ))}
      </div>

      {/* Amount field */}
      <div>
        <label className="block text-[10px] font-medium text-[#8b8f9a] mb-1 px-1">Valor (R$)</label>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
          placeholder={`Mínimo R$ ${MIN}`}
          className="w-full bg-[#252a3a] border border-[#2a2e3b] rounded-lg px-3 py-3 text-base text-white outline-none focus:border-blue-500/60"
        />
        <p className="text-[10px] text-[#8b8f9a] mt-1">
          Mínimo R$ {MIN.toLocaleString('pt-BR')} · Máximo R$ {MAX.toLocaleString('pt-BR')}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!valid || loading}
        className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? <><Loader2 size={14} className="animate-spin" /> Gerando QR…</> : <>Gerar QR Code</>}
      </button>
    </div>
  )
}

function QrStep({
  deposit, amountNum, copied, onCopy, onCancel,
}: {
  deposit: CreatedDeposit; amountNum: number
  copied: boolean; onCopy: () => void; onCancel: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-white p-3 rounded-lg">
        <QRCodeSVG value={deposit.qrcode} size={200} level="M" />
      </div>

      <div className="text-center">
        <div className="text-xs text-[#8b8f9a]">Valor a pagar</div>
        <div className="text-2xl font-bold text-white">R$ {amountNum.toFixed(2).replace('.', ',')}</div>
      </div>

      <button
        onClick={onCopy}
        className={cn(
          'w-full h-10 rounded-lg border text-xs font-bold transition-colors flex items-center justify-center gap-2',
          copied
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
            : 'bg-[#252a3a] border-[#2a2e3b] text-white hover:border-blue-500/50'
        )}
      >
        {copied ? <><Check size={13} /> Copiado!</> : <><Copy size={13} /> Copiar PIX Copia-e-Cola</>}
      </button>

      <div className="flex items-center gap-2 text-xs text-blue-400 mt-1">
        <Loader2 size={12} className="animate-spin" />
        Aguardando pagamento…
      </div>

      <p className="text-[10px] text-[#8b8f9a] text-center leading-relaxed mt-1">
        Após o pagamento, esta tela atualiza automaticamente.<br/>
        Se houver erro, fecha esta janela e gera outro QR.
      </p>

      <button
        onClick={onCancel}
        className="text-xs text-[#8b8f9a] hover:text-white mt-1"
      >
        Cancelar e fechar
      </button>
    </div>
  )
}

function PaidStep({ amount, onClose }: { amount: number; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-4">
      <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
        <CheckCircle2 size={28} className="text-emerald-400" />
      </div>
      <h3 className="text-base font-bold text-white">Depósito confirmado!</h3>
      <p className="text-sm text-[#ccc]">
        R$ {amount.toFixed(2).replace('.', ',')} foi creditado na sua conta real.
      </p>
      <button
        onClick={onClose}
        className="mt-3 px-5 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors"
      >
        Fechar
      </button>
    </div>
  )
}

function ExpiredStep({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-4">
      <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center">
        <Clock size={26} className="text-red-400" />
      </div>
      <h3 className="text-base font-bold text-white">Não foi possível concluir</h3>
      <p className="text-sm text-[#ccc]">
        O depósito falhou ou foi cancelado. Você pode tentar novamente.
      </p>
      <button
        onClick={onRetry}
        className="mt-3 px-5 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white"
      >
        Tentar novamente
      </button>
    </div>
  )
}

// ── PIX brand mark ─────────────────────────────────────────────────────────
function PixIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#32BCAD" />
      <path d="M20.5 11.5L16 16l-4.5-4.5m9 9L16 16l4.5 4.5m-9 0L16 16l-4.5 4.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
