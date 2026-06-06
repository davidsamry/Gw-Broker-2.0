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
import { X, Loader2, Copy, CheckCircle2, ArrowLeft } from 'lucide-react'
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
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1f232e]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
              <span className="text-emerald-400 font-black text-xs">₮</span>
            </div>
            <h2 className="text-sm font-bold text-white">Depositar em USDT</h2>
          </div>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── FORM phase ── */}
          {phase === 'form' && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-[#8b8f9a] leading-relaxed">
                Depósito em USDT na rede <span className="text-emerald-400 font-semibold">TRC20</span> (Tron).
                Você digita o valor em <span className="text-white font-semibold">R$</span> — fazemos
                a cotação automática para USDT.
              </p>

              <div>
                <label className="text-[10px] text-[#8b8f9a] uppercase font-bold tracking-wide">Valor em R$</label>
                <input
                  type="number"
                  min={MIN_BRL}
                  max={MAX_BRL}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100,00"
                  className="w-full mt-1 bg-[#0f1117] border border-[#1f232e] rounded-lg px-3 py-2.5 text-white font-bold text-lg outline-none focus:border-emerald-500/60"
                />
                <p className="text-[10px] text-[#8b8f9a] mt-1">
                  Mín R$ {formatBrl(MIN_BRL)} · Máx R$ {formatBrl(MAX_BRL)}
                </p>
              </div>

              {/* Preview USDT */}
              <div className="bg-[#0f1117] border border-[#1f232e] rounded-lg p-3 flex items-center justify-between">
                <span className="text-xs text-[#8b8f9a]">Você vai enviar</span>
                <span className="text-base font-bold text-emerald-400">
                  {usdtPreview > 0 ? `${usdtPreview.toFixed(4)} USDT` : '— USDT'}
                </span>
              </div>
              {rate && (
                <p className="text-[10px] text-[#8b8f9a] -mt-2">
                  Cotação: 1 USDT = R$ {rate.toFixed(4)} <span className="text-emerald-400">(spot Binance)</span>
                </p>
              )}

              {error && (
                <p className="text-red-400 text-xs text-center bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                onClick={generate}
                disabled={loading || !validAmount || !rate}
                className="w-full h-11 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition-all font-bold text-black flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : 'Gerar endereço USDT'}
              </button>

              {onSwitchToPix && (
                <button
                  onClick={onSwitchToPix}
                  className="flex items-center justify-center gap-1 text-xs text-[#8b8f9a] hover:text-white transition-colors"
                >
                  <ArrowLeft size={12} /> Pagar com PIX
                </button>
              )}
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
