'use client'

// Deposito em USDT TRC20 via BSPay crypto cashin.
//
// Fluxo:
//   1. User digita amount em R\$ → cotamos USDT em real-time (preview)
//   2. Clica "Gerar endereço" → POST /deposits/usdt → recebe address+QR
//   3. Mostra address + valor exato USDT + QR + countdown
//   4. Polling a cada 5s — quando status=PAID, redireciona
//
// SEPARADO do DepositoModal (PIX) pra nao misturar a logica de bonus
// + CPF + fases do PIX. USDT NAO usa bonus por enquanto.

import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { X, Loader2, Copy, CheckCircle2, Banknote } from 'lucide-react'

// ── Logo helpers (duplicados do DepositoModal pra evitar import-cycle) ───
function PixLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      <rect x="8"  y="9"  width="16" height="3"  rx="0.5" fill="white"/>
      <rect x="14" y="9"  width="4"  height="14" rx="0.5" fill="white"/>
      <rect x="11" y="14" width="10" height="2"  rx="0.5" fill="#059669"/>
    </svg>
  )
}
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth'

interface CreatedUsdtDeposit {
  id:             string
  amountBrl:      string
  amountUsdt:     string
  rate:           string
  network:        string
  depositAddress: string
  expiresAt:      string | null
  status:         string
  createdAt:      string
}

interface Props {
  onClose:        () => void
  /** Chamado quando o usuario clica "Voltar pra PIX" — pai pode abrir o
   *  outro modal. Opcional — se null, so' fecha. */
  onSwitchToPix?: () => void
}

type Phase = 'form' | 'address' | 'paid' | 'expired'

const MIN_BRL = 60   // mesmo minimo do PIX
const MAX_BRL = 100_000
const POLL_MS = 5_000

function formatBrl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function UsdtDepositoModal({ onClose, onSwitchToPix }: Props) {
  const refreshAccounts = useAuthStore(s => s.refreshAccounts)

  const [phase, setPhase]       = useState<Phase>('form')
  const [amount, setAmount]     = useState<string>('100')
  const [rate, setRate]         = useState<number | null>(null)   // USDTBRL preview
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [deposit, setDeposit]   = useState<CreatedUsdtDeposit | null>(null)
  const [copied, setCopied]     = useState(false)
  const [now, setNow]           = useState(Date.now())
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const amountNum   = parseFloat(amount.replace(',', '.')) || 0
  const validAmount = amountNum >= MIN_BRL && amountNum <= MAX_BRL
  const usdtPreview = rate && validAmount ? (amountNum / rate) : 0

  // Cotacao USDTBRL via Binance (mesma fonte do backend). Cache local 30s.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL')
        const json = await res.json() as { price: string }
        if (!cancelled) setRate(Number(json.price))
      } catch { /* mostra "—" no preview */ }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Tick pra countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Polling do status apos gerar endereco
  useEffect(() => {
    if (phase !== 'address' || !deposit) return
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<{ deposit: { status: string } }>(`/deposits/${deposit.id}`)
        if (data.deposit.status === 'PAID') {
          setPhase('paid')
          if (pollRef.current) clearInterval(pollRef.current)
          // refresh balance — webhook ja' creditou, so' atualiza store local
          await refreshAccounts().catch(() => {})
        } else if (data.deposit.status === 'FAILED' || data.deposit.status === 'CANCELLED') {
          setPhase('expired')
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch { /* keep polling */ }
    }, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [phase, deposit?.id, refreshAccounts])

  async function generate() {
    if (!validAmount) return
    setLoading(true); setError('')
    try {
      const { data } = await api.post<{ deposit: CreatedUsdtDeposit }>('/deposits/usdt', { amount: amountNum })
      setDeposit(data.deposit)
      setPhase('address')
    } catch (err: any) {
      const code = err?.response?.data?.error ?? ''
      if      (code === 'PAYMENT_GATEWAY_UNAVAILABLE') setError('Pagamentos crypto indisponíveis no momento.')
      else if (code === 'PAYMENT_GATEWAY_ERROR')       setError('Erro no provedor crypto. Tente novamente.')
      else if (code === 'RATE_UNAVAILABLE')            setError('Cotação USDT/BRL indisponível. Tente em alguns segundos.')
      else if (code === 'ACCOUNT_NOT_FOUND')           setError('Sua conta real não foi encontrada.')
      else                                              setError('Erro ao gerar endereço USDT.')
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    if (!deposit) return
    try {
      await navigator.clipboard.writeText(deposit.depositAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked */ }
  }

  // Countdown ate' expira_at (ou —:— se sem expiracao definida)
  const expiresMs = deposit?.expiresAt ? new Date(deposit.expiresAt).getTime() : 0
  const remainingMs = Math.max(0, expiresMs - now)
  const remainingMin = Math.floor(remainingMs / 60_000)
  const remainingSec = Math.floor((remainingMs % 60_000) / 1000)

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] bg-[#13161f] border border-[#1f232e] rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
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

        {/* Cards de metodo — PIX (switch) + USDT (ativo) */}
        {phase === 'form' && onSwitchToPix && (
          <div className="px-5 pb-3 grid grid-cols-2 gap-3 flex-shrink-0">
            {/* PIX — switch */}
            <button
              onClick={onSwitchToPix}
              className="rounded-xl border-2 border-[#2a2e3b] bg-[#1a1e2a] px-3 py-3 hover:border-emerald-500/40 hover:bg-[#1d2130] transition-all text-left group"
            >
              <div className="flex items-center gap-2.5">
                <PixLogo size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white leading-tight">PIX</span>
                    <span className="inline-flex items-center px-1.5 py-px rounded bg-emerald-500/15 border border-emerald-500/30 text-[8px] font-bold text-emerald-300 uppercase tracking-wide">
                      Top
                    </span>
                  </div>
                  <div className="text-[10px] text-[#7c8195] leading-tight mt-0.5">Depósito instantâneo</div>
                </div>
              </div>
            </button>
            {/* USDT — ATIVO */}
            <div className="rounded-xl border-2 border-emerald-500/60 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 px-3 py-3 shadow-[0_4px_16px_-4px_rgba(16,185,129,0.3)]">
              <div className="flex items-center gap-2.5">
                <TetherLogo size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white leading-tight">USDT</span>
                    <span className="inline-flex items-center px-1.5 py-px rounded bg-blue-500/15 border border-blue-500/30 text-[8px] font-bold text-blue-300 uppercase tracking-wide">
                      Tron
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-300 leading-tight mt-0.5">Transferência via rede</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* ── FORM phase ── */}
          {phase === 'form' && (
            <div className="flex flex-col gap-4">

              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="text-[11px] font-bold text-[#bdc1cf] uppercase tracking-wide">Valor do depósito</label>
                  <span className="text-[10px] text-[#7c8195]">
                    Mín R$ {formatBrl(MIN_BRL)} · Máx R$ {formatBrl(MAX_BRL)}
                  </span>
                </div>
                <div className={`relative flex items-center rounded-xl border-2 transition-colors bg-gradient-to-b from-[#1d2130] to-[#191c29] ${
                  validAmount ? 'border-emerald-500/50 shadow-[0_0_0_3px_rgba(16,185,129,0.06)]' : 'border-[#2a2e3b] focus-within:border-emerald-500/40'
                }`}>
                  <span className="pl-4 pr-1 text-base font-bold text-emerald-400/80 select-none">R$</span>
                  <input
                    type="number"
                    min={MIN_BRL}
                    max={MAX_BRL}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    className="flex-1 bg-transparent py-3.5 pr-4 text-xl font-bold text-white outline-none placeholder:text-[#3d4256] placeholder:font-normal tracking-tight"
                  />
                </div>
              </div>

              {/* Preview USDT — destaque maior */}
              <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/30 rounded-xl p-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-[10px] text-emerald-400/70 uppercase tracking-wide font-bold">Você vai enviar</p>
                    <p className="text-xl font-black text-emerald-400 mt-0.5">
                      {usdtPreview > 0 ? usdtPreview.toFixed(4) : '—'} <span className="text-sm font-bold">USDT</span>
                    </p>
                  </div>
                  {rate && (
                    <div className="text-right">
                      <p className="text-[9px] text-[#7c8195] uppercase tracking-wide">cotação</p>
                      <p className="text-[11px] text-white font-mono font-semibold">R$ {rate.toFixed(4)}</p>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-xs text-center bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                onClick={generate}
                disabled={loading || !validAmount || !rate}
                className={`mt-1 w-full h-12 rounded-xl text-[13px] font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
                  loading || !validAmount || !rate
                    ? 'bg-[#1d2130] text-[#4d5266] border border-[#2a2e3b] cursor-not-allowed'
                    : 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.7)] hover:-translate-y-px hover:shadow-[0_10px_28px_-8px_rgba(16,185,129,0.8)] active:translate-y-0'
                }`}
              >
                {loading ? <><Loader2 size={14} className="animate-spin" /> Gerando…</> : 'Gerar endereço USDT'}
              </button>
            </div>
          )}

          {/* ── ADDRESS phase (waiting payment) ── */}
          {phase === 'address' && deposit && (
            <div className="flex flex-col gap-3">
              {/* Aviso forte */}
              <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-lg px-3 py-2.5">
                <p className="text-xs text-yellow-200 leading-snug">
                  Envie <span className="font-bold">EXATAMENTE {deposit.amountUsdt} USDT</span>{' '}
                  na rede <span className="font-bold">{deposit.network}</span>.
                  Valores diferentes podem não ser creditados.
                </p>
              </div>

              {/* QR Code do endereco */}
              <div className="bg-white rounded-lg p-3 flex items-center justify-center self-center">
                <QRCodeSVG value={deposit.depositAddress} size={160} />
              </div>

              {/* Endereco */}
              <div>
                <label className="text-[10px] text-[#8b8f9a] uppercase font-bold tracking-wide">Endereço da carteira</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-[#0f1117] border border-[#1f232e] rounded px-2 py-2 text-[11px] text-emerald-400 font-mono break-all">
                    {deposit.depositAddress}
                  </code>
                  <button
                    onClick={copy}
                    className="px-3 py-2 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 transition-colors flex items-center gap-1.5 text-[10px] font-bold"
                  >
                    {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                    {copied ? 'OK' : 'Copiar'}
                  </button>
                </div>
              </div>

              {/* Resumo */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#0f1117] border border-[#1f232e] rounded p-2">
                  <div className="text-[10px] text-[#8b8f9a]">Valor (R$)</div>
                  <div className="text-white font-bold">R$ {formatBrl(parseFloat(deposit.amountBrl))}</div>
                </div>
                <div className="bg-[#0f1117] border border-[#1f232e] rounded p-2">
                  <div className="text-[10px] text-[#8b8f9a]">Cotação</div>
                  <div className="text-white font-semibold">R$ {deposit.rate}</div>
                </div>
              </div>

              {/* Countdown */}
              {deposit.expiresAt && (
                <div className="text-center text-xs text-[#8b8f9a]">
                  Expira em{' '}
                  <span className="text-white font-mono font-bold">
                    {String(remainingMin).padStart(2, '0')}:{String(remainingSec).padStart(2, '0')}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-center gap-1.5 text-[10px] text-[#8b8f9a]">
                <Loader2 size={11} className="animate-spin" />
                Aguardando confirmação on-chain…
              </div>
            </div>
          )}

          {/* ── PAID phase ── */}
          {phase === 'paid' && deposit && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 size={48} className="text-emerald-400" />
              <h3 className="text-base font-bold text-white">Pagamento confirmado!</h3>
              <p className="text-xs text-[#8b8f9a]">
                R$ {formatBrl(parseFloat(deposit.amountBrl))} foram creditados na sua conta.
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 font-bold text-black text-sm"
              >
                Fechar
              </button>
            </div>
          )}

          {/* ── EXPIRED phase ── */}
          {phase === 'expired' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <X size={48} className="text-red-400" />
              <h3 className="text-base font-bold text-white">Cobrança expirada</h3>
              <p className="text-xs text-[#8b8f9a]">
                Gere uma nova cobrança pra continuar.
              </p>
              <button
                onClick={() => { setPhase('form'); setDeposit(null) }}
                className="mt-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 font-bold text-black text-sm"
              >
                Nova cobrança
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
