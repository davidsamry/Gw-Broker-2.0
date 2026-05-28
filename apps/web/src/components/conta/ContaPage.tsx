'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Camera, CheckCircle2, Lock, Globe, Clock, X, ChevronDown, Pencil,
  ChevronRight, Landmark, Zap, ChevronLeft, Plus, ArrowDownLeft, ArrowUpRight,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore, type KycSubmission as KycSub } from '@/store/auth'
import { useWithdrawalsStore, type ApiWithdrawal, type WithdrawalMethod } from '@/store/withdrawals'
import { useTransactionsStore, type TransactionType } from '@/store/transactions'
import { useOperationsStore, type ApiOperation } from '@/store/operations'
import { ASSETS } from '@/lib/mockData'
import { api } from '@/lib/api'
import { TwoFactorSetup } from '@/components/admin/TwoFactorSetup'
import { KycUploadModal } from '@/components/conta/KycUploadModal'

type ContaTab = 'retirada' | 'transacoes' | 'operacoes' | 'minha-conta'

const CONTA_TABS: { key: ContaTab; label: string }[] = [
  { key: 'retirada', label: 'Retirada' },
  { key: 'transacoes', label: 'Transações' },
  { key: 'operacoes', label: 'Operações' },
  { key: 'minha-conta', label: 'Minha Conta' },
]

const FAQ_RETIRADA = [
  ['Como posso retirar dinheiro da conta?', 'O que é a verificação de conta?'],
  ['Quanto tempo leva para retirar fundos?', 'Como entendo que preciso passar pela verificação da conta?'],
  ['Qual é o valor mínimo da retirada?', 'Quanto tempo leva o processo de verificação?'],
  ['Existe alguma taxa para depositar ou retirar fundos da conta?', 'Como posso saber se meus dados estão verificados com sucesso?'],
  ['Preciso fornecer algum documento para fazer uma retirada?', ''],
]

const WITHDRAWAL_METHOD_LABEL: Record<WithdrawalMethod, string> = {
  PIX:           'PIX',
  USDT_TRC20:    'USDT (TRC-20)',
  BANK_TRANSFER: 'Transferência bancária',
}

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatWithdrawalDate(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return { date: `${dd}.${mm}.${yyyy}`, time: `${hh}:${mi}:${ss}` }
}

function FloatingInput({
  label, value, onChange, rightLabel, rightLabelColor = 'text-green-400', readOnly = false, placeholder, type = 'text',
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  rightLabel?: string
  rightLabelColor?: string
  readOnly?: boolean
  placeholder?: string
  type?: 'text' | 'date'
}) {
  return (
    <div>
      {/* Label above the field — separate row so it never overlaps the
          input text/placeholder. */}
      <label className="block text-[11px] font-medium text-[#8b8f9a] mb-1.5 px-1">
        {label}
      </label>
      <div className="flex items-center justify-between border border-[#2a2e3b] rounded-lg px-3 py-2.5 bg-[#1a1e2e] focus-within:border-blue-500/50 transition-colors">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder-[#3a3f50] min-w-0"
        />
        {rightLabel && (
          <span className={cn('text-xs font-semibold ml-2 flex-shrink-0', rightLabelColor)}>{rightLabel}</span>
        )}
      </div>
    </div>
  )
}

function FloatingSelect({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative border border-[#2a2e3b] rounded-lg px-3 pt-4 pb-2 bg-[#1a1e2e] cursor-pointer">
      <span className="absolute top-1.5 left-3 text-[10px] text-[#8b8f9a] font-medium">{label}</span>
      <div className="flex items-center justify-between">
        <span className="text-sm text-white">{value}</span>
        <ChevronDown size={14} className="text-[#8b8f9a]" />
      </div>
    </div>
  )
}

function Toggle({ label, defaultOn = true }: { label: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn)
  return (
    <button onClick={() => setOn(!on)} className="flex items-center gap-3 text-left">
      <div className={cn('relative w-10 h-5 rounded-full transition-colors flex-shrink-0', on ? 'bg-blue-500' : 'bg-[#3a3f50]')}>
        <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
      </div>
      <span className="text-sm text-white">{label}</span>
    </button>
  )
}

const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  DEMO_CREDIT: 'Crédito demo',
  DEPOSIT:     'Depósito',
  WITHDRAWAL:  'Retirada',
  TRADE_WIN:   'Lucro de operação',
  TRADE_LOSS:  'Operação',
  BONUS:       'Bônus',
}

function formatDateTimeBR(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}:${ss}`
}

function TransacoesTab() {
  const transactions = useTransactionsStore((s) => s.transactions)
  const refetch      = useTransactionsStore((s) => s.refetch)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header — refresh button (no pagination yet, we cap at 100) */}
      <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-3 flex-shrink-0">
        <span className="text-xs text-[#8b8f9a]">
          {transactions.length} {transactions.length === 1 ? 'transação' : 'transações'}
        </span>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2e3b] text-xs text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors"
        >
          Atualizar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6">
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[#252a3a] flex items-center justify-center mb-3">
              <ArrowDownLeft size={20} className="text-[#8b8f9a]" />
            </div>
            <p className="text-sm text-[#8b8f9a]">Nenhuma transação ainda.</p>
            <p className="text-xs text-[#8b8f9a]/70 mt-1">
              Depósitos, retiradas e operações aparecerão aqui.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table header */}
            <div className="hidden md:grid grid-cols-[180px_200px_180px_1fr_140px] gap-4 pb-2 border-b border-[#2a2e3b] mb-1">
              {['ID', 'Data e hora', 'Tipo', 'Descrição', 'Valor'].map((h) => (
                <span key={h} className="text-xs text-[#8b8f9a] font-medium">{h}</span>
              ))}
            </div>

            {/* Rows — desktop = grid, mobile = stacked card */}
            {transactions.map((tx) => {
              const amount   = parseFloat(tx.amount)
              const negative = amount < 0
              const sign     = negative ? '' : '+'
              return (
                <div key={tx.id} className="border-b border-[#2a2e3b]/50">
                  {/* Desktop row */}
                  <div className="hidden md:grid grid-cols-[180px_200px_180px_1fr_140px] gap-4 py-3 items-center">
                    <span className="text-xs text-white font-mono truncate">{tx.id.slice(0, 12).toUpperCase()}</span>
                    <span className="text-xs text-[#8b8f9a]">{formatDateTimeBR(tx.createdAt)}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 size={9} className="text-white" />
                      </div>
                      <span className="text-xs text-[#ccc]">{TRANSACTION_TYPE_LABEL[tx.type]}</span>
                    </div>
                    <span className="text-xs text-[#8b8f9a] truncate">{tx.description ?? '—'}</span>
                    <span className={cn('text-xs font-semibold text-right', negative ? 'text-red-400' : 'text-green-400')}>
                      {sign}R$ {formatBRL(Math.abs(amount))}
                    </span>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden py-3 px-1">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-white font-medium">{TRANSACTION_TYPE_LABEL[tx.type]}</span>
                        <span className="text-[10px] text-[#8b8f9a] mt-0.5">{formatDateTimeBR(tx.createdAt)}</span>
                      </div>
                      <span className={cn('text-sm font-semibold whitespace-nowrap', negative ? 'text-red-400' : 'text-green-400')}>
                        {sign}R$ {formatBRL(Math.abs(amount))}
                      </span>
                    </div>
                    {tx.description && (
                      <p className="text-[11px] text-[#8b8f9a] truncate">{tx.description}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

function MiniChartIcon() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" fill="none" className="text-[#8b8f9a]">
      <polyline points="0,12 5,8 9,10 13,4 17,6 22,2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  )
}

function OperacoesTab() {
  const [subTab, setSubTab] = useState<'historico' | 'pendentes'>('historico')
  const operations = useOperationsStore((s) => s.operations)
  const refetch    = useOperationsStore((s) => s.refetch)

  // Histórico = WON/LOST/CANCELLED · Pendentes = OPEN
  const filtered = useMemo(() => {
    return operations.filter((o) => subTab === 'pendentes'
      ? o.status === 'OPEN'
      : o.status === 'WON' || o.status === 'LOST' || o.status === 'CANCELLED'
    )
  }, [operations, subTab])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex items-center gap-4 md:gap-6 px-4 md:px-6 pt-3 md:pt-4 pb-0 border-b border-[#2a2e3b] flex-shrink-0 overflow-x-auto">
        <button
          onClick={() => setSubTab('historico')}
          className={cn(
            'pb-3 text-xs md:text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex-shrink-0',
            subTab === 'historico' ? 'text-white border-white font-semibold' : 'text-blue-400 border-transparent hover:text-blue-300'
          )}
        >
          Histórico de negociações
        </button>
        <button
          onClick={() => setSubTab('pendentes')}
          className={cn(
            'pb-3 text-xs md:text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex-shrink-0',
            subTab === 'pendentes' ? 'text-white border-white font-semibold' : 'text-blue-400 border-transparent hover:text-blue-300'
          )}
        >
          Negociações pendentes
        </button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-3 flex-shrink-0">
        <span className="text-xs text-[#8b8f9a]">
          {filtered.length} {filtered.length === 1 ? 'operação' : 'operações'}
        </span>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2e3b] text-xs text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors"
        >
          Atualizar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[#252a3a] flex items-center justify-center mb-3">
              <MiniChartIcon />
            </div>
            <p className="text-sm text-[#8b8f9a]">
              {subTab === 'pendentes' ? 'Nenhuma operação pendente.' : 'Nenhuma operação finalizada.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table header */}
            <div className="hidden md:grid grid-cols-[180px_220px_140px_180px_180px_120px_120px] gap-3 py-2 border-b border-[#2a2e3b] mb-1">
              {['Ativo', 'ID', 'Status', 'Preço de abertura', 'Preço de fechamento', 'Valor', 'Lucro'].map((h) => (
                <span key={h} className="text-xs text-[#8b8f9a] font-medium">{h}</span>
              ))}
            </div>

            {filtered.map((op) => {
              const asset = ASSETS.find((a) => a.id === op.assetId)
              const amount = parseFloat(op.amount)
              const profit = parseFloat(op.profit ?? '0')
              const isUp   = op.direction === 'CALL'
              const net    = op.status === 'WON' ? profit
                           : op.status === 'LOST' ? -amount
                           : 0
              return (
                <div key={op.id} className="border-b border-[#2a2e3b]/40 hover:bg-white/[0.02] transition-colors">
                  {/* Desktop row */}
                  <div className="hidden md:grid grid-cols-[180px_220px_140px_180px_180px_120px_120px] gap-3 py-3 items-center">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base flex-shrink-0">{asset?.flag1}{asset?.flag2}</span>
                      <span className="text-xs text-white truncate">{asset?.label ?? op.assetSymbol}</span>
                    </div>
                    <span className="text-[10px] text-[#8b8f9a] font-mono break-all leading-tight">{op.id}</span>
                    <OperationStatusBadge status={op.status} />
                    <div>
                      <div className="text-xs text-white font-medium">{op.entryPrice ?? '—'}</div>
                      <div className="text-[10px] text-[#8b8f9a] mt-0.5">{formatDateTimeBR(op.openedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-white font-medium">
                        {op.status === 'OPEN' ? '— (em andamento)' : '—'}
                      </div>
                      <div className="text-[10px] text-[#8b8f9a] mt-0.5">
                        {op.closedAt ? formatDateTimeBR(op.closedAt) : formatDateTimeBR(op.expiresAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isUp
                        ? <ArrowUpRight   size={12} className="text-green-400 flex-shrink-0" />
                        : <ArrowDownLeft size={12} className="text-red-400  flex-shrink-0" />}
                      <span className={cn('text-xs font-semibold', isUp ? 'text-green-400' : 'text-red-400')}>
                        R$ {formatBRL(amount)}
                      </span>
                    </div>
                    <span className={cn('text-xs font-semibold',
                      net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-[#8b8f9a]')}>
                      {net > 0 ? '+' : ''}R$ {formatBRL(Math.abs(net))}
                    </span>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden py-3 px-1">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base flex-shrink-0">{asset?.flag1}{asset?.flag2}</span>
                        <div className="min-w-0">
                          <div className="text-xs text-white font-medium truncate">{asset?.label ?? op.assetSymbol}</div>
                          <div className="text-[10px] text-[#8b8f9a]">{formatDateTimeBR(op.openedAt)}</div>
                        </div>
                      </div>
                      <span className={cn('text-sm font-semibold whitespace-nowrap',
                        net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-[#8b8f9a]')}>
                        {net > 0 ? '+' : ''}R$ {formatBRL(Math.abs(net))}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <OperationStatusBadge status={op.status} />
                      <div className="flex items-center gap-1 text-xs text-[#8b8f9a]">
                        {isUp
                          ? <ArrowUpRight   size={12} className="text-green-400 flex-shrink-0" />
                          : <ArrowDownLeft size={12} className="text-red-400  flex-shrink-0" />}
                        <span>R$ {formatBRL(amount)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

function OperationStatusBadge({ status }: { status: ApiOperation['status'] }) {
  const map = {
    OPEN:      { color: 'text-blue-400',    label: 'Em aberto' },
    WON:       { color: 'text-green-400',   label: 'Vencida'   },
    LOST:      { color: 'text-red-400',     label: 'Perdida'   },
    CANCELLED: { color: 'text-[#8b8f9a]',   label: 'Cancelada' },
  } as const
  const cfg = map[status] ?? map.OPEN
  return <span className={cn('text-xs font-semibold', cfg.color)}>{cfg.label}</span>
}

// Minimal modal for creating a new withdrawal request. Lets the user pick
// amount + method + destination (PIX key / wallet address). Server validates
// balance, debits, and returns the persisted row which the parent upserts.
function NovaRetiradaModal({
  accountId,
  maxAmount,
  onClose,
  onCreated,
}: {
  accountId: string
  maxAmount: number
  onClose:   () => void
  onCreated: (w: ApiWithdrawal) => void
}) {
  const [amount, setAmount]         = useState('')
  const [method, setMethod]         = useState<WithdrawalMethod>('PIX')
  const [destination, setDest]      = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  // Admin-editable limits via /admin/configuracoes. authStore.settings
  // is hydrated from /auth/me; fallback to the migration defaults until
  // it resolves.
  const settings = useAuthStore((s) => s.settings)
  const WD_MIN = settings?.withdrawalMin ?? 60
  const WD_MAX = Math.min(settings?.withdrawalMax ?? Infinity, maxAmount)

  const amountNum = parseFloat(amount.replace(',', '.')) || 0
  const valid     = amountNum >= WD_MIN && amountNum <= WD_MAX && destination.trim().length >= 3

  const destPlaceholder = method === 'PIX'
    ? 'Chave PIX (CPF / email / telefone / aleatória)'
    : method === 'USDT_TRC20'
      ? 'Endereço da carteira TRC-20'
      : 'Banco / agência / conta'

  async function submit() {
    if (!valid || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const { data } = await api.post('/withdrawals', {
        accountId,
        amount: Math.round(amountNum * 100) / 100,
        method,
        destination: destination.trim(),
      })
      onCreated(data.withdrawal as ApiWithdrawal)
    } catch (err: any) {
      const code = err?.response?.data?.error
      const body = err?.response?.data
      if      (code === 'INSUFFICIENT_BALANCE') setError('Saldo insuficiente.')
      else if (code === 'ACCOUNT_NOT_FOUND')    setError('Conta não encontrada.')
      else if (code === 'ROLLOVER_INCOMPLETE')  setError(
        `Rollover incompleto: você precisa operar mais R$ ${Number(body.remaining ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} antes de sacar.`
      )
      else if (code === 'VALIDATION_ERROR') {
        const first = body?.details?.fieldErrors?.amount?.[0] ?? 'Valor inválido.'
        setError(first)
      }
      else setError('Erro ao solicitar retirada.')
    } finally {
      setSubmitting(false)
    }
  }

  // Read rollover from auth-store user.accounts so we can show a hint
  // even before the user clicks Solicitar. Same data the backend uses.
  const account = useAuthStore.getState().user?.accounts.find(a => a.id === accountId)
  const rolloverRequired = Number((account as any)?.rolloverRequired ?? 0)
  const rolloverProgress = Number((account as any)?.rolloverProgress ?? 0)
  const rolloverRemaining = Math.max(0, rolloverRequired - rolloverProgress)

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] bg-[#1a1e2e] border border-[#2a2e3b] rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
          <h2 className="text-sm font-bold text-white">Nova retirada</h2>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Rollover hint — only when the user has a pending requirement.
              Blocks the form entirely when the gap > 0, but still renders
              the input so the user can see the disabled state + reason. */}
          {rolloverRemaining > 0 && (
            <div className="px-3 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-yellow-300 mb-1">
                ⚠ Rollover incompleto
              </div>
              <p className="text-yellow-200/90 leading-relaxed">
                Você precisa operar mais <strong className="text-white">R$ {rolloverRemaining.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> em volume na conta REAL antes de poder sacar.
              </p>
              <p className="text-yellow-200/60 mt-1 text-[10px]">
                Progresso: R$ {rolloverProgress.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / R$ {rolloverRequired.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Valor (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="60,00"
              className="w-full bg-[#252a3a] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
            />
            <p className="text-[10px] text-[#8b8f9a] mt-1">
              Mín: R$ {formatBRL(WD_MIN)} · Máx: R$ {formatBRL(Math.min(settings?.withdrawalMax ?? Infinity, maxAmount))} · Disponível R$ {formatBRL(maxAmount)}
            </p>
          </div>

          {/* Method */}
          <div>
            <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Método</label>
            <div className="grid grid-cols-3 gap-2">
              {(['PIX', 'USDT_TRC20', 'BANK_TRANSFER'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    'px-2 py-2 rounded-lg text-[11px] font-semibold transition-colors border',
                    method === m
                      ? 'bg-blue-600/20 border-blue-500/60 text-white'
                      : 'bg-[#252a3a] border-[#2a2e3b] text-[#8b8f9a] hover:text-white'
                  )}
                >
                  {WITHDRAWAL_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Destino</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDest(e.target.value)}
              placeholder={destPlaceholder}
              className="w-full bg-[#252a3a] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
            />
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={!valid || submitting}
            className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Enviando…' : 'Confirmar retirada'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RetiradaTab() {
  const authStore   = useAuthStore()
  const withdrawals = useWithdrawalsStore((s) => s.withdrawals)
  const upsertOne   = useWithdrawalsStore((s) => s.upsertOne)
  const refetch     = useWithdrawalsStore((s) => s.refetch)

  // Admin-editable minimum withdrawal threshold. Falls back to 60 if
  // /auth/me hasn't resolved yet (matches the migration default).
  const settings    = useAuthStore((s) => s.settings)
  const WD_MIN      = settings?.withdrawalMin ?? 60

  // Real account (always REAL — demo withdrawals don't make sense).
  const realAccount   = authStore.user?.accounts.find((a) => a.type === 'REAL')
  const balance       = realAccount ? parseFloat(realAccount.balance) : 0
  const pendingTotal  = useMemo(
    () => withdrawals
      .filter((w) => w.status === 'PENDING' && w.accountId === realAccount?.id)
      .reduce((s, w) => s + parseFloat(w.amount), 0),
    [withdrawals, realAccount?.id],
  )
  // Balance is already debited on create — so "Disponível" == account.balance.
  // "Na conta" displays balance + pending (what the user originally had).
  const totalOnAccount = balance + pendingTotal

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  async function handleCancel(id: string) {
    if (cancellingId) return
    setCancellingId(id)
    try {
      await api.post(`/withdrawals/${id}/cancel`)
      // Optimistically mark cancelled and refund balance.
      const cancelled = withdrawals.find((w) => w.id === id)
      if (cancelled) {
        upsertOne({ ...cancelled, status: 'CANCELLED', processedAt: new Date().toISOString() })
        authStore.applyBalanceDelta(cancelled.accountId, parseFloat(cancelled.amount))
      }
    } catch {
      // Refetch on failure to resync state.
      refetch()
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {createOpen && realAccount && (
        <NovaRetiradaModal
          accountId={realAccount.id}
          maxAmount={balance}
          onClose={() => setCreateOpen(false)}
          onCreated={(w) => {
            upsertOne(w)
            authStore.applyBalanceDelta(w.accountId, -parseFloat(w.amount))
            setCreateOpen(false)
          }}
        />
      )}
      {/* Layout: stacked on mobile, 3 columns on desktop. */}
      <div className="flex flex-col md:flex-row min-h-full">

        {/* Left — Conta (real balance from authStore) */}
        <div className="w-full md:w-[260px] md:flex-shrink-0 px-4 md:px-6 py-4 md:py-6 border-b md:border-b-0 md:border-r border-[#2a2e3b]">
          <div className="grid grid-cols-2 md:grid-cols-1 gap-4">
            <div>
              <div className="text-[11px] md:text-xs text-[#8b8f9a] mb-1">Na conta:</div>
              <div className="text-lg md:text-2xl font-bold text-white">R$ {formatBRL(totalOnAccount)}</div>
            </div>
            <div className="hidden md:block border-t border-dashed border-[#2a2e3b] my-1" />
            <div>
              <div className="text-[11px] md:text-xs text-[#8b8f9a] mb-1">Disponível para retirada:</div>
              <div className="text-lg md:text-2xl font-bold text-white">R$ {formatBRL(balance)}</div>
              {pendingTotal > 0 && (
                <div className="text-[10px] text-orange-400 mt-1">
                  R$ {formatBRL(pendingTotal)} aguardando confirmação
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Middle — Retirada + histórico */}
        <div className="flex-1 min-w-0 px-4 md:px-6 py-4 md:py-6 border-b md:border-b-0 md:border-r border-[#2a2e3b] flex flex-col">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <p className="text-sm font-semibold text-white">Retirada:</p>
            <button
              onClick={() => setCreateOpen(true)}
              disabled={balance < WD_MIN}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={13} />
              Solicitar retirada
            </button>
          </div>

          {/* Inline insufficient-balance warning — surfaces the limit and
              the user's current balance so the disabled button doesn't
              look broken. Only shown when the user can't withdraw yet. */}
          {balance < WD_MIN && (
            <div className="flex items-start gap-2 px-3 py-2 mb-3 md:mb-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-200 leading-snug">
                Saldo insuficiente para sacar. Mínimo:{' '}
                <strong className="text-white">R$ {formatBRL(WD_MIN)}</strong>
              </p>
            </div>
          )}

          <div className="border-t border-dashed border-[#2a2e3b] mb-4 md:mb-5" />

          {/* Recent orders header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
            <p className="text-sm font-semibold text-white">Alguns de seus pedidos recentes:</p>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors self-start md:self-auto"
            >
              Atualizar
              <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <ChevronRight size={11} className="text-white" />
              </span>
            </button>
          </div>

          {/* Withdrawals list — real data from store */}
          {withdrawals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 rounded-full bg-[#252a3a] flex items-center justify-center mb-3">
                <Landmark size={20} className="text-[#8b8f9a]" />
              </div>
              <p className="text-sm text-[#8b8f9a] leading-relaxed">
                Você ainda não tem retiradas.
              </p>
              <p className="text-xs text-[#8b8f9a]/70 mt-1">
                Use o botão "Solicitar retirada" para criar a primeira.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0">
              {withdrawals.map((w) => {
                const dt        = formatWithdrawalDate(w.createdAt)
                const amount    = parseFloat(w.amount)
                const isPending = w.status === 'PENDING'
                const isCancelled = w.status === 'CANCELLED' || w.status === 'FAILED'
                return (
                  <div key={w.id}>
                    <button
                      onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}
                      className="w-full text-left hover:bg-white/5 transition-colors border-b border-[#2a2e3b]/50 py-3 px-1"
                    >
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <div className="flex flex-col min-w-0">
                          <span className="text-[11px] md:text-xs text-[#8b8f9a] font-mono truncate">{w.id.slice(0, 12).toUpperCase()}</span>
                          <span className="text-[10px] md:text-[11px] text-[#8b8f9a] mt-0.5">{dt.date} · {dt.time}</span>
                        </div>
                        <span className="text-sm font-semibold text-red-400 flex-shrink-0 whitespace-nowrap">
                          -R$ {formatBRL(amount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <>
                              <div className="w-3.5 h-3.5 rounded-full border-2 border-orange-400 flex-shrink-0" />
                              <span className="text-xs text-orange-400">Aguardando confirmação</span>
                            </>
                          )}
                          {w.status === 'APPROVED' && (
                            <>
                              <CheckCircle2 size={14} className="text-blue-400 flex-shrink-0" />
                              <span className="text-xs text-blue-400">Aprovada — enviando</span>
                            </>
                          )}
                          {w.status === 'COMPLETED' && (
                            <>
                              <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                              <span className="text-xs text-green-400">Concluída</span>
                            </>
                          )}
                          {isCancelled && (
                            <>
                              <X size={14} className="text-red-400 flex-shrink-0" />
                              <span className="text-xs text-[#8b8f9a]">
                                {w.status === 'CANCELLED' ? 'Cancelada' : 'Falhou'}
                              </span>
                            </>
                          )}
                        </div>
                        <span className="text-xs text-[#8b8f9a] flex-shrink-0">
                          {WITHDRAWAL_METHOD_LABEL[w.method]}
                        </span>
                      </div>
                    </button>

                    {expandedId === w.id && isPending && (
                      <div className="mt-2 mb-3 ml-2 md:ml-4">
                        <div className="bg-[#1a1e2e] border border-[#2a2e3b] rounded-xl px-3 md:px-4 py-3 max-w-full md:max-w-[360px]">
                          <p className="text-xs text-[#8b8f9a] mb-1">Destino:</p>
                          <p className="text-xs text-white font-mono break-all mb-3">{w.destination}</p>
                          <p className="text-xs text-[#ccc] leading-relaxed mb-3">
                            A retirada está sendo processada. Cancele a qualquer momento para receber o valor de volta no saldo.
                          </p>
                          <button
                            onClick={() => handleCancel(w.id)}
                            disabled={cancellingId === w.id}
                            className="px-4 py-1.5 rounded-lg border border-[#3a3f50] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                          >
                            {cancellingId === w.id ? 'Cancelando…' : 'Cancelar retirada'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Footer info */}
          <div className="mt-6 md:mt-auto pt-4 md:pt-6 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Landmark size={13} className="text-green-400 flex-shrink-0" />
              <span className="text-xs text-[#8b8f9a]">Valor mínimo do depósito: <span className="text-green-400 font-semibold">R$60</span></span>
            </div>
            <div className="flex items-center gap-2">
              <Landmark size={13} className="text-green-400 flex-shrink-0" />
              <span className="text-xs text-[#8b8f9a]">Valor mínimo de retirada: <span className="text-green-400 font-semibold">R$60</span></span>
            </div>
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-orange-400 flex-shrink-0" />
              <span className="text-xs text-[#8b8f9a]">Retirada rápida de sua conta</span>
            </div>
          </div>

          {/* Security badges — wrap on mobile */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 md:gap-4 mt-4 md:mt-5 pt-4 border-t border-[#2a2e3b]">
            {['Verified by VISA', 'SECURE PAYMENT', 'MasterCard SecureCode', '3D Secure', 'SSL ENCRYPTION'].map((b) => (
              <div key={b} className="flex flex-col items-center gap-0.5 opacity-40">
                <div className="w-8 h-8 rounded bg-[#2a2e3b]" />
                <span className="text-[8px] text-[#8b8f9a] text-center leading-tight max-w-[48px]">{b}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — FAQ — single column on mobile, 2 cols on desktop */}
        <div className="w-full md:w-[420px] md:flex-shrink-0 px-4 md:px-6 py-4 md:py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
            <p className="text-sm font-semibold text-white">FAQ:</p>
            <button className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors self-start md:self-auto">
              Confira todas as perguntas frequentes
              <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <ChevronRight size={11} className="text-white" />
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {FAQ_RETIRADA.flatMap((row) => row.filter(Boolean)).map((q, i) => (
              <button key={i} className="flex items-start gap-2 text-left group">
                <ChevronDown size={13} className="text-[#8b8f9a] mt-0.5 flex-shrink-0 group-hover:text-white transition-colors" />
                <span className="text-xs text-[#8b8f9a] group-hover:text-white transition-colors leading-relaxed">{q}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

// Minha Conta — dados pessoais reais (User table) + save via PATCH /auth/me.
// Security panel + Idioma/Fuso panel kept as static placeholders since those
// features aren't backed yet.
function MinhaContaTab() {
  const authStore = useAuthStore()
  const user      = authStore.user
  const kycSub    = authStore.kycSubmission
  const [kycModalOpen, setKycModalOpen] = useState(false)

  const [nickname,  setNickname]  = useState(user?.nickname  ?? '')
  const [name,      setName]      = useState(user?.name      ?? '')
  const [lastName,  setLastName]  = useState(user?.lastName  ?? '')
  const [birthDate, setBirthDate] = useState(user?.birthDate ?? '')
  const [cpf,       setCpf]       = useState(user?.cpf       ?? '')
  const [email,     setEmail]     = useState(user?.email     ?? '')
  const [country,   setCountry]   = useState(user?.country   ?? 'Brasil')
  const [address,   setAddress]   = useState(user?.address   ?? '')
  const [saving,    setSaving]    = useState(false)
  const [savedAt,   setSavedAt]   = useState<number | null>(null)
  const [error,     setError]     = useState('')

  // 2FA UI state
  const [twoFAOpen,     setTwoFAOpen]     = useState<'setup' | 'disable' | null>(null)
  const [disableCode,   setDisableCode]   = useState('')
  const [disableLoading, setDisableLoading] = useState(false)
  const [disableError,  setDisableError]  = useState('')

  // Change-password UI state. Modal opens on "Mudar" click, holds the
  // three fields, calls POST /auth/change-password, and surfaces the
  // backend's error codes as friendly Portuguese strings.
  const [pwOpen,       setPwOpen]       = useState(false)
  const [pwCurrent,    setPwCurrent]    = useState('')
  const [pwNew,        setPwNew]        = useState('')
  const [pwConfirm,    setPwConfirm]    = useState('')
  const [pwLoading,    setPwLoading]    = useState(false)
  const [pwError,      setPwError]      = useState('')
  const [pwSuccess,    setPwSuccess]    = useState(false)

  function openPasswordModal() {
    setPwCurrent('')
    setPwNew('')
    setPwConfirm('')
    setPwError('')
    setPwSuccess(false)
    setPwOpen(true)
  }

  async function submitChangePassword() {
    if (pwLoading) return
    setPwError('')
    if (!pwCurrent) { setPwError('Informe sua senha atual.'); return }
    if (pwNew.length < 6) { setPwError('A nova senha precisa ter pelo menos 6 caracteres.'); return }
    if (pwNew !== pwConfirm) { setPwError('A confirmação não coincide com a nova senha.'); return }
    if (pwNew === pwCurrent) { setPwError('A nova senha deve ser diferente da atual.'); return }
    setPwLoading(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: pwCurrent,
        newPassword:     pwNew,
      })
      setPwSuccess(true)
      // Auto-close after a moment so the user sees the confirmation.
      setTimeout(() => setPwOpen(false), 1400)
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'INVALID_CURRENT_PASSWORD') setPwError('Senha atual incorreta.')
      else if (code === 'SAME_PASSWORD')            setPwError('A nova senha deve ser diferente da atual.')
      else if (code === 'VALIDATION_ERROR')         setPwError('Dados inválidos — verifique o tamanho da senha.')
      else                                          setPwError('Não foi possível alterar a senha. Tente novamente.')
    } finally {
      setPwLoading(false)
    }
  }

  async function refreshUser() {
    try {
      const { data } = await api.get('/auth/me')
      if (data?.user) useAuthStore.setState({ user: data.user })
    } catch { /* ignore */ }
  }

  async function handle2FAToggle() {
    if (!user) return
    setDisableError('')
    if (user.twoFactorEnabled) {
      setDisableCode('')
      setTwoFAOpen('disable')
    } else {
      setTwoFAOpen('setup')
    }
  }

  async function confirmDisable() {
    if (disableLoading || disableCode.length !== 6) return
    setDisableLoading(true)
    setDisableError('')
    try {
      await api.post('/auth/2fa/disable', { code: disableCode })
      await refreshUser()
      setTwoFAOpen(null)
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'INVALID_2FA_CODE')    setDisableError('Código inválido.')
      else if (code === 'ADMIN_2FA_REQUIRED')  setDisableError('Administradores não podem desativar 2FA.')
      else                                      setDisableError('Erro ao desativar.')
      setDisableCode('')
    } finally {
      setDisableLoading(false)
    }
  }

  // Re-sync local state if the user object changes (e.g. background revalidate).
  useEffect(() => {
    if (!user) return
    setNickname (user.nickname  ?? '')
    setName     (user.name      ?? '')
    setLastName (user.lastName  ?? '')
    setBirthDate(user.birthDate ?? '')
    setCpf      (user.cpf       ?? '')
    setEmail    (user.email     ?? '')
    setCountry  (user.country   ?? 'Brasil')
    setAddress  (user.address   ?? '')
  }, [user?.id, user?.updatedAt])

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[#8b8f9a]">Carregando…</p>
      </div>
    )
  }

  const shortId = user.id.slice(0, 8).toUpperCase()

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const { data } = await api.patch('/auth/me', {
        name:      name.trim()      || undefined,
        email:     email.trim().toLowerCase() || undefined,
        nickname:  nickname.trim(),
        lastName:  lastName.trim(),
        birthDate: birthDate || null,
        cpf:       cpf.trim(),
        country:   country.trim(),
        address:   address.trim(),
      })
      // Push updated user into authStore so the rest of the app sees fresh data.
      if (data?.user) {
        useAuthStore.setState({ user: data.user })
      }
      setSavedAt(Date.now())
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'VALIDATION_ERROR') setError('Algum campo é inválido.')
      else if (code === 'EMAIL_TAKEN')      setError('Este e-mail já está em uso por outra conta.')
      else                                  setError('Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* KYC upload modal */}
      {kycModalOpen && (
        <KycUploadModal
          onClose={() => setKycModalOpen(false)}
          onDone={() => setKycModalOpen(false)}
        />
      )}

      {/* 2FA setup modal */}
      {twoFAOpen === 'setup' && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setTwoFAOpen(null)}>
          <div className="w-full max-w-[440px] bg-[#13161f] border border-[#1f232e] rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e]">
              <h2 className="text-sm font-bold text-white">Ativar verificação em duas etapas</h2>
              <button onClick={() => setTwoFAOpen(null)} className="text-[#8b8f9a] hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-5 py-4">
              <TwoFactorSetup
                onEnabled={async () => { await refreshUser(); setTwoFAOpen(null) }}
                onCancel={() => setTwoFAOpen(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Change-password modal — current / new / confirm. Mirrors the 2FA
          modal styling so the security panel feels consistent. */}
      {pwOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { if (!pwLoading) setPwOpen(false) }}
        >
          <div
            className="w-full max-w-[420px] bg-[#13161f] border border-[#1f232e] rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e]">
              <h2 className="text-sm font-bold text-white">Alterar senha</h2>
              <button
                onClick={() => { if (!pwLoading) setPwOpen(false) }}
                className="text-[#8b8f9a] hover:text-white"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            {pwSuccess ? (
              <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
                <CheckCircle2 size={36} className="text-green-400" />
                <p className="text-sm font-semibold text-white">Senha alterada com sucesso.</p>
                <p className="text-xs text-[#8b8f9a]">Use a nova senha nos próximos logins.</p>
              </div>
            ) : (
              <div className="px-5 py-5 flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#8b8f9a]">Senha atual</span>
                  <input
                    autoFocus
                    type="password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#8b8f9a]">Nova senha (mín. 6 caracteres)</span>
                  <input
                    type="password"
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#8b8f9a]">Confirmar nova senha</span>
                  <input
                    type="password"
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitChangePassword() }}
                    className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60"
                  />
                </label>
                {pwError && (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    {pwError}
                  </p>
                )}
                <button
                  onClick={submitChangePassword}
                  disabled={pwLoading}
                  className="mt-1 w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white transition-colors disabled:opacity-50"
                >
                  {pwLoading ? 'Alterando…' : 'Alterar senha'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2FA disable modal */}
      {twoFAOpen === 'disable' && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setTwoFAOpen(null)}>
          <div className="w-full max-w-[400px] bg-[#13161f] border border-[#1f232e] rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e]">
              <h2 className="text-sm font-bold text-white">Desativar 2FA</h2>
              <button onClick={() => setTwoFAOpen(null)} className="text-[#8b8f9a] hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-5 py-5 flex flex-col gap-4">
              <p className="text-xs text-[#ccc] leading-relaxed">
                Digite o código atual do seu app autenticador para confirmar.
              </p>
              <input
                autoFocus
                inputMode="numeric"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-3 text-center text-xl font-mono text-white outline-none focus:border-blue-500/60 tracking-[0.5em]"
              />
              {disableError && <p className="text-xs text-red-400 text-center">{disableError}</p>}
              <button
                onClick={confirmDisable}
                disabled={disableLoading || disableCode.length !== 6}
                className="w-full h-10 rounded-lg bg-red-500 hover:bg-red-400 text-sm font-bold text-white transition-colors disabled:opacity-50"
              >
                {disableLoading ? 'Desativando…' : 'Desativar 2FA'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-0 min-h-full">

        {/* Left — Dados pessoais */}
        <div className="w-full md:flex-1 md:max-w-[540px] px-4 md:px-8 py-4 md:py-6 border-b md:border-b-0 md:border-r border-[#2a2e3b]">
          <p className="text-sm font-semibold text-white mb-4 md:mb-5">Dados pessoais:</p>

          <div className="flex items-center gap-4 mb-5 md:mb-6">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-blue-500/20 border-2 border-blue-500/40 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-9 h-9 text-blue-400 fill-current">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
              </div>
              <button className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[#2a2e3b] border border-[#3a3f50] flex items-center justify-center hover:bg-[#3a3f50] transition-colors">
                <Camera size={11} className="text-[#8b8f9a]" />
              </button>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{user.email}</div>
              <div className="text-xs text-[#8b8f9a] mt-0.5">ID: {shortId}</div>
              <div className="flex items-center gap-1.5 mt-1">
                {user.kycStatus === 'APPROVED' ? (
                  <>
                    <CheckCircle2 size={12} className="text-green-400" />
                    <span className="text-xs font-semibold text-green-400">Verificado</span>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-orange-400 capitalize">
                    KYC: {user.kycStatus.toLowerCase()}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* KYC card — only shown when verification is needed or in-flight */}
          {user.kycStatus !== 'APPROVED' && (
            <KycCard
              status={user.kycStatus as 'PENDING' | 'SUBMITTED' | 'REJECTED'}
              submission={kycSub}
              onUpload={() => setKycModalOpen(true)}
            />
          )}

          <div className="flex flex-col gap-3">
            <FloatingInput label="Apelido"             value={nickname}  onChange={setNickname}  placeholder="Como prefere ser chamado" />
            <FloatingInput label="Nome"                value={name}      onChange={setName}      placeholder="Seu primeiro nome" />
            <FloatingInput label="Sobrenome"           value={lastName}  onChange={setLastName}  placeholder="Seu sobrenome" />
            <FloatingInput label="Data de nascimento"  value={birthDate} onChange={setBirthDate} type="date" />
            <FloatingInput label="CPF"                 value={cpf}       onChange={setCpf}       placeholder="000.000.000-00" />
            <FloatingInput label="Email"               value={email}     onChange={setEmail} placeholder="seu@email.com" />
            <FloatingInput label="País"                value={country}   onChange={setCountry} />
            <FloatingInput label="Endereço"            value={address}   onChange={setAddress}   placeholder="Rua, número, cidade" />
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
          )}
          {savedAt && !error && (
            <p className="mt-3 text-xs text-green-400">Salvo ✓</p>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="mt-5 w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>

        {/* Middle — Segurança (placeholders) */}
        <div className="w-full md:flex-1 md:max-w-[480px] px-4 md:px-8 py-4 md:py-6 border-b md:border-b-0 md:border-r border-[#2a2e3b]">
          <p className="text-sm font-semibold text-white mb-4 md:mb-5">Segurança:</p>

          <div className="mb-5">
            <div className="flex items-center gap-2 mb-1">
              {user.twoFactorEnabled
                ? <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                : <CheckCircle2 size={16} className="text-[#3a3f50] flex-shrink-0" />}
              <span className="text-sm font-semibold text-white">Verificação em duas etapas</span>
            </div>
            <div className="ml-6">
              <span className="text-xs text-[#8b8f9a]">
                {user.twoFactorEnabled
                  ? 'Aplicativo autenticador configurado.'
                  : 'Não configurada. Ative para proteger sua conta.'}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-4 mb-6">
            <button
              onClick={handle2FAToggle}
              className="flex items-center gap-3 text-left"
            >
              <div className={cn('relative w-10 h-5 rounded-full transition-colors flex-shrink-0', user.twoFactorEnabled ? 'bg-blue-500' : 'bg-[#3a3f50]')}>
                <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', user.twoFactorEnabled ? 'translate-x-5' : 'translate-x-0.5')} />
              </div>
              <span className="text-sm text-white">App autenticador (TOTP)</span>
            </button>
          </div>

          <div className="border-t border-[#2a2e3b] pt-5">
            <div className="flex items-start gap-3">
              <Lock size={16} className="text-[#8b8f9a] mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-white mb-0.5">Senha</div>
                <div className="text-xs text-[#8b8f9a] mb-1.5">Alterar a senha da sua conta</div>
                <button
                  onClick={openPasswordModal}
                  className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Mudar
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right — Idioma + Fuso + Excluir (static for now) */}
        <div className="w-full md:flex-1 px-4 md:px-8 py-4 md:py-6">
          <div className="mb-4">
            <div className="border border-[#2a2e3b] rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-[#2a2e3b]">
                <span className="text-[10px] text-[#8b8f9a] font-medium">Idioma</span>
              </div>
              <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-[#8b8f9a]" />
                  <span className="text-sm text-white">Português</span>
                </div>
                <ChevronDown size={14} className="text-[#8b8f9a]" />
              </button>
            </div>
          </div>

          <div className="mb-8">
            <div className="border border-[#2a2e3b] rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-[#2a2e3b]">
                <span className="text-[10px] text-[#8b8f9a] font-medium">Fuso horário</span>
              </div>
              <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2">
                  <Clock size={15} className="text-[#8b8f9a]" />
                  <span className="text-sm text-white">(UTC-03:00)</span>
                </div>
                <ChevronDown size={14} className="text-[#8b8f9a]" />
              </button>
            </div>
          </div>

          <button className="flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors">
            <X size={14} />
            <span className="text-sm font-semibold">Excluir minha conta</span>
          </button>
        </div>

      </div>
    </div>
  )
}

export function ContaPage({ initialTab = 'minha-conta', onClose }: { initialTab?: ContaTab; onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<ContaTab>(initialTab)

  return (
    <div className="flex-1 flex flex-col bg-[#151822] min-h-0 overflow-hidden">

      {/* Top bar: tabs (scrollable) + close button (fixed on the right) */}
      <div className="flex items-stretch border-b border-[#2a2e3b] bg-[#1a1e2e] flex-shrink-0">
        <div className="flex items-center px-3 md:px-6 flex-1 min-w-0 gap-1 overflow-x-auto">
          {CONTA_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'px-3 md:px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap flex-shrink-0',
                activeTab === t.key
                  ? 'text-white border-white font-semibold'
                  : 'text-[#8b8f9a] border-transparent hover:text-white'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center w-12 flex-shrink-0 text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors border-l border-[#2a2e3b]"
            title="Fechar"
          >
            <X size={16} />
          </button>
        )}
      </div>


      {/* Tab content */}
      {activeTab === 'retirada'    && <RetiradaTab />}
      {activeTab === 'transacoes'  && <TransacoesTab />}
      {activeTab === 'operacoes'   && <OperacoesTab />}
      {activeTab === 'minha-conta' && <MinhaContaTab />}

    </div>
  )
}

// ── KycCard ─────────────────────────────────────────────────────────────────
// CTA / status panel shown above the personal-data form. Renders different
// content depending on where the verification is in its lifecycle.

function KycCard({ status, submission, onUpload }: {
  status:     'PENDING' | 'SUBMITTED' | 'REJECTED'
  submission: KycSub | null
  onUpload:   () => void
}) {
  if (status === 'SUBMITTED') {
    const sentAt = submission ? new Date(submission.submittedAt).toLocaleString('pt-BR') : null
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mb-3">
        <Clock size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-bold text-blue-400">Documentos em análise</div>
          <div className="text-xs text-[#ccc] mt-0.5">
            Sua verificação está sendo analisada. Prazo: até 48 horas.
            {sentAt && <span className="block text-[10px] text-[#8b8f9a] mt-1">Enviado em {sentAt}</span>}
          </div>
        </div>
      </div>
    )
  }

  if (status === 'REJECTED') {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 mb-3">
        <X size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-bold text-red-400">Verificação rejeitada</div>
          {submission?.reason && (
            <div className="text-xs text-[#ccc] mt-1">
              <span className="text-[10px] uppercase font-bold text-[#8b8f9a]">Motivo: </span>
              {submission.reason}
            </div>
          )}
          <button
            onClick={onUpload}
            className="mt-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors"
          >
            Enviar novamente
          </button>
        </div>
      </div>
    )
  }

  // PENDING (never submitted yet)
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-orange-500/10 border border-orange-500/30 mb-3">
      <Camera size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="text-sm font-bold text-orange-400">Conta não verificada</div>
        <div className="text-xs text-[#ccc] mt-0.5">
          Envie 3 fotos (documento frente, verso e selfie segurando o documento) para
          desbloquear retiradas e operar com conta real.
        </div>
        <button
          onClick={onUpload}
          className="mt-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors"
        >
          Verificar conta agora
        </button>
      </div>
    </div>
  )
}
