'use client'

import { useState, useMemo } from 'react'
import {
  Camera, CheckCircle2, Lock, Globe, Clock, X, ChevronDown, Pencil,
  ChevronRight, Landmark, Zap, ChevronLeft, Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnalisePage } from '@/components/analise/AnalisePage'
import { useAuthStore } from '@/store/auth'
import { useWithdrawalsStore, type ApiWithdrawal, type WithdrawalMethod } from '@/store/withdrawals'
import { api } from '@/lib/api'

type ContaTab = 'retirada' | 'transacoes' | 'operacoes' | 'minha-conta' | 'mercado' | 'torneios' | 'analise'

const CONTA_TABS: { key: ContaTab; label: string }[] = [
  { key: 'retirada', label: 'Retirada' },
  { key: 'transacoes', label: 'Transações' },
  { key: 'operacoes', label: 'Operações' },
  { key: 'minha-conta', label: 'Minha Conta' },
  { key: 'mercado', label: 'Mercado' },
  { key: 'torneios', label: 'Torneios' },
  { key: 'analise', label: 'Análise' },
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
  label, value, rightLabel, rightLabelColor = 'text-green-400', readOnly = false,
}: {
  label: string; value: string; rightLabel?: string; rightLabelColor?: string; readOnly?: boolean
}) {
  return (
    <div className="relative border border-[#2a2e3b] rounded-lg px-3 pt-4 pb-2 bg-[#1a1e2e] focus-within:border-blue-500/50 transition-colors">
      <span className="absolute top-1.5 left-3 text-[10px] text-[#8b8f9a] font-medium">{label}</span>
      <div className="flex items-center justify-between">
        <input
          defaultValue={value}
          readOnly={readOnly}
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder-[#8b8f9a]"
        />
        {rightLabel && (
          <span className={cn('text-xs font-semibold ml-2', rightLabelColor)}>{rightLabel}</span>
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

const MOCK_TRANSACOES = [
  { id: '40741052802', date: '20/05/2026, 14:04:05', status: 'pending',  tipo: 'Pagamento', sistema: 'USDT',         valor: '-R$200.000,00', negative: true  },
  { id: '40739150181', date: '04/03/2026, 00:10:17', status: 'failed',   tipo: 'Pagamento', sistema: 'USDT',         valor: '-R$100.000,00', negative: true  },
  { id: '40739150061', date: '04/03/2026, 00:01:54', status: 'failed',   tipo: 'Pagamento', sistema: 'USDT',         valor: '-R$100.000,00', negative: true  },
  { id: '99920249',    date: '07/10/2025, 04:45:42', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$50.000,00',  negative: false },
  { id: '40735297787', date: '27/09/2025, 19:28:42', status: 'success',  tipo: 'Pagamento', sistema: 'USDT',         valor: '-R$213.764,00', negative: true  },
  { id: '98719862',    date: '22/09/2025, 09:04:15', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$50.000,00',  negative: false },
  { id: '97033484',    date: '02/09/2025, 10:27:00', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$50.000,00',  negative: false },
  { id: '96462703',    date: '26/08/2025, 12:02:35', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$50.000,00',  negative: false },
  { id: '40734520540', date: '25/08/2025, 12:17:23', status: 'success',  tipo: 'Pagamento', sistema: 'USDT',         valor: '-R$216.176,00', negative: true  },
  { id: '96080675',    date: '22/08/2025, 06:03:43', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$50.000,00',  negative: false },
  { id: '95724345',    date: '18/08/2025, 11:45:15', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$50.000,00',  negative: false },
  { id: '94903974',    date: '10/08/2025, 10:57:03', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$50.000,00',  negative: false },
  { id: '94518266',    date: '06/08/2025, 15:23:32', status: 'success',  tipo: 'Depósito',  sistema: 'USDT (TRC-20)',valor: '+R$30.000,00',  negative: false },
]

function StatusBadge({ status }: { status: string }) {
  if (status === 'pending') return (
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 rounded-full border-2 border-[#8b8f9a] flex-shrink-0" />
      <span className="text-xs text-[#8b8f9a]">Aguardando confirmação</span>
    </div>
  )
  if (status === 'failed') return (
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
        <X size={9} className="text-white" />
      </div>
      <span className="text-xs text-red-400 font-medium">Falhado</span>
    </div>
  )
  return (
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 size={9} className="text-white" />
      </div>
      <span className="text-xs text-green-400 font-medium">Bem-sucedido</span>
    </div>
  )
}

function TransacoesTab() {
  const [expandedId, setExpandedId] = useState<string | null>('40741052802')
  const [page] = useState(1)
  const totalPages = 6

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Pagination top-right */}
      <div className="flex items-center justify-end gap-2 px-6 py-3 flex-shrink-0">
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2e3b] text-xs text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors">
          <ChevronLeft size={13} />
          Anterior
        </button>
        <span className="text-xs text-[#8b8f9a] font-medium px-2">{page}/{totalPages}</span>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white font-semibold transition-colors">
          Próximo
          <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
            <ChevronRight size={10} className="text-white" />
          </div>
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6">
        {/* Header */}
        <div className="grid grid-cols-[180px_200px_220px_1fr_160px_140px] gap-4 pb-2 border-b border-[#2a2e3b] mb-1">
          {['ID da Transação','Data e hora','Status','Tipo de transação','Sistema de pagamento','Valor'].map((h) => (
            <span key={h} className="text-xs text-[#8b8f9a] font-medium">{h}</span>
          ))}
        </div>

        {/* Rows */}
        {MOCK_TRANSACOES.map((tx) => (
          <div key={tx.id} className="border-b border-[#2a2e3b]/50">
            <button
              onClick={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
              className="w-full grid grid-cols-[180px_200px_220px_1fr_160px_140px] gap-4 py-4 text-left hover:bg-white/[0.02] transition-colors"
            >
              <span className="text-xs text-white font-mono">{tx.id}</span>
              <span className="text-xs text-[#8b8f9a]">{tx.date}</span>
              <div className="flex items-center gap-2">
                <StatusBadge status={tx.status} />
                {tx.status === 'pending' && (
                  <span className="px-2 py-0.5 rounded bg-[#2a2e3b] text-[10px] font-semibold text-white border border-[#3a3f50]">
                    Cancelar
                  </span>
                )}
              </div>
              <span className="text-xs text-[#8b8f9a]">{tx.tipo}</span>
              <span className="text-xs text-[#8b8f9a]">{tx.sistema}</span>
              <span className={cn('text-xs font-semibold text-right', tx.negative ? 'text-red-400' : 'text-green-400')}>
                {tx.valor}
              </span>
            </button>

            {/* Expanded info for pending */}
            {expandedId === tx.id && tx.status === 'pending' && (
              <div className="pb-4 pl-[184px]">
                <div className="bg-[#1a1e2e] border border-[#2a2e3b] rounded-xl px-4 py-3 max-w-[320px] text-xs text-[#ccc] leading-relaxed">
                  A retirada está sendo processada no lado do operador financeiro. Aguarde - os fundos devem ser recebidos dentro de 48 horas.
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const MOCK_OPERACOES = [
  { payout: '94%', uuid: '9f829204-7597-42b5-9ef7-81085fab8776', openPrice: '25.178', openTime: '20/05/2026, 14:02:29', closePrice: '25.172', closeTime: '20/05/2026, 14:03:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '29100.00R$', dir: 'down' },
  { payout: '94%', uuid: '912c332c-f728-4c7f-b94a-ce47ccb8e421', openPrice: '25.178', openTime: '20/05/2026, 14:02:29', closePrice: '25.172', closeTime: '20/05/2026, 14:03:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '29100.00R$', dir: 'down' },
  { payout: '94%', uuid: '6fd150d5-3280-4861-9cd3-a96e80a316ac', openPrice: '25.178', openTime: '20/05/2026, 14:02:29', closePrice: '25.172', closeTime: '20/05/2026, 14:03:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '29100.00R$', dir: 'down' },
  { payout: '94%', uuid: '2ffac17f-6e30-4f4f-a1f7-6d934c5b596b', openPrice: '25.185', openTime: '20/05/2026, 14:02:29', closePrice: '25.172', closeTime: '20/05/2026, 14:03:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '29100.00R$', dir: 'down' },
  { payout: '94%', uuid: '2d71f660-76eb-4f1c-8f89-cd3ddbd305fd', openPrice: '25.185', openTime: '20/05/2026, 14:02:29', closePrice: '25.172', closeTime: '20/05/2026, 14:03:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '29100.00R$', dir: 'down' },
  { payout: '94%', uuid: '1ffd39b2-91db-46cf-bd2e-b101f41b34ac', openPrice: '25.185', openTime: '20/05/2026, 14:02:29', closePrice: '25.172', closeTime: '20/05/2026, 14:03:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '29100.00R$', dir: 'down' },
  { payout: '93%', uuid: 'db9ab997-223a-478f-9039-39781aadd843', openPrice: '25.137', openTime: '20/05/2026, 14:01:26', closePrice: '25.169', closeTime: '20/05/2026, 14:02:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '28950.00R$', dir: 'up' },
  { payout: '93%', uuid: 'c2daef62-2433-426a-a356-d096513e5805', openPrice: '25.141', openTime: '20/05/2026, 14:01:27', closePrice: '25.169', closeTime: '20/05/2026, 14:02:00', ip: '38.211.207.215', valor: '15000.00R$', lucro: '28950.00R$', dir: 'up' },
]

function MiniChartIcon() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" fill="none" className="text-[#8b8f9a]">
      <polyline points="0,12 5,8 9,10 13,4 17,6 22,2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  )
}

function OperacoesTab() {
  const [subTab, setSubTab] = useState<'historico' | 'pendentes'>('historico')
  const [contaTipo, setContaTipo] = useState<'real' | 'demo'>('real')
  const [contaDropOpen, setContaDropOpen] = useState(false)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex items-center gap-6 px-6 pt-4 pb-0 border-b border-[#2a2e3b] flex-shrink-0">
        <button
          onClick={() => setSubTab('historico')}
          className={cn(
            'pb-3 text-sm font-medium border-b-2 -mb-px transition-colors',
            subTab === 'historico' ? 'text-white border-white font-semibold' : 'text-blue-400 border-transparent hover:text-blue-300'
          )}
        >
          Histórico de negociações
        </button>
        <button
          onClick={() => setSubTab('pendentes')}
          className={cn(
            'pb-3 text-sm font-medium border-b-2 -mb-px transition-colors',
            subTab === 'pendentes' ? 'text-white border-white font-semibold' : 'text-blue-400 border-transparent hover:text-blue-300'
          )}
        >
          Negociações pendentes
        </button>
      </div>

      {/* Filters + pagination */}
      <div className="flex items-center gap-3 px-6 py-3 flex-shrink-0">
        {/* Date range */}
        <div className="relative border border-[#2a2e3b] rounded-lg px-3 pt-5 pb-2 bg-[#1a1e2e] min-w-[220px]">
          <span className="absolute top-1.5 left-3 text-[10px] text-[#8b8f9a] font-medium">Intervalo de datas:</span>
          <div className="flex items-center gap-2">
            <Clock size={12} className="text-[#8b8f9a]" />
            <span className="text-sm text-white">20.05.2025 - 20.05.2026</span>
          </div>
        </div>

        {/* Account type */}
        <div className="relative min-w-[160px]">
          <button
            onClick={() => setContaDropOpen(!contaDropOpen)}
            className="relative w-full border border-[#2a2e3b] rounded-lg px-3 pt-5 pb-2 bg-[#1a1e2e] text-left hover:border-blue-500/40 transition-colors"
          >
            <span className="absolute top-1.5 left-3 text-[10px] text-[#8b8f9a] font-medium">Tipo de Conta:</span>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-white">{contaTipo === 'real' ? 'Conta real' : 'Conta demo'}</span>
              <ChevronDown size={13} className={cn('text-[#8b8f9a] transition-transform', contaDropOpen && 'rotate-180')} />
            </div>
          </button>

          {contaDropOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1e2e] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-50">
              {(['real', 'demo'] as const).map((tipo) => (
                <button
                  key={tipo}
                  onClick={() => { setContaTipo(tipo); setContaDropOpen(false) }}
                  className={cn(
                    'w-full px-4 py-2.5 text-sm text-left transition-colors',
                    contaTipo === tipo ? 'bg-white/10 text-white font-semibold' : 'text-[#8b8f9a] hover:bg-white/5 hover:text-white'
                  )}
                >
                  {tipo === 'real' ? 'Conta real' : 'Conta demo'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Export */}
        <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2a2e3b] text-xs text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 9v2h9V9M6.5 1v7M4 5l2.5 3L9 5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Exportar para
          <ChevronDown size={12} />
        </button>

        {/* Pagination */}
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#2a2e3b] text-xs text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors">
          <ChevronLeft size={13} />
          Anterior
        </button>
        <span className="text-xs text-[#8b8f9a] font-medium px-1">1/422</span>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white font-semibold transition-colors">
          Próximo
          <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
            <ChevronRight size={10} className="text-white" />
          </div>
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6">
        {/* Header */}
        <div className="grid grid-cols-[180px_280px_60px_160px_160px_160px_120px_120px] gap-3 py-2 border-b border-[#2a2e3b] mb-1">
          {['Ativo','Informações','Gráfico','Preço de abertura','Preço de fechamento','IP','Valor','Lucro'].map((h) => (
            <span key={h} className="text-xs text-[#8b8f9a] font-medium">{h}</span>
          ))}
        </div>

        {/* Rows */}
        {MOCK_OPERACOES.map((op, i) => (
          <div key={i} className="grid grid-cols-[180px_280px_60px_160px_160px_160px_120px_120px] gap-3 py-3 border-b border-[#2a2e3b]/40 hover:bg-white/[0.02] transition-colors items-center">
            {/* Ativo */}
            <div className="flex items-center gap-2">
              <img src="https://flagcdn.com/w40/us.png" alt="US" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
              <span className="text-xs text-white leading-tight">Pfizer Inc (OTC)</span>
            </div>

            {/* Informações */}
            <div>
              <div className="text-xs font-semibold text-white mb-0.5">{op.payout}</div>
              <div className="text-[10px] text-[#8b8f9a] font-mono break-all leading-tight">{op.uuid}</div>
            </div>

            {/* Gráfico */}
            <div className="flex items-center justify-center">
              <MiniChartIcon />
            </div>

            {/* Preço de abertura */}
            <div>
              <div className="text-xs text-white font-medium">{op.openPrice}</div>
              <div className="text-[10px] text-[#8b8f9a] mt-0.5">{op.openTime}</div>
            </div>

            {/* Preço de fechamento */}
            <div>
              <div className="text-xs text-white font-medium">{op.closePrice}</div>
              <div className="text-[10px] text-[#8b8f9a] mt-0.5">{op.closeTime}</div>
            </div>

            {/* IP */}
            <div className="flex items-center gap-1.5">
              <img src="https://flagcdn.com/w40/br.png" alt="BR" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
              <span className="text-xs text-[#8b8f9a] font-mono">{op.ip}</span>
            </div>

            {/* Valor */}
            <div className="flex items-center gap-1">
              {op.dir === 'down' ? (
                <svg width="10" height="10" viewBox="0 0 10 10" className="text-red-400 flex-shrink-0">
                  <path d="M5 9L1 3h8L5 9z" fill="currentColor"/>
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" className="text-green-400 flex-shrink-0">
                  <path d="M5 1l4 6H1L5 1z" fill="currentColor"/>
                </svg>
              )}
              <span className={cn('text-xs font-semibold', op.dir === 'down' ? 'text-red-400' : 'text-green-400')}>
                {op.valor}
              </span>
            </div>

            {/* Lucro */}
            <span className="text-xs font-semibold text-green-400">{op.lucro}</span>
          </div>
        ))}
      </div>
    </div>
  )
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

  const amountNum = parseFloat(amount.replace(',', '.')) || 0
  const valid     = amountNum >= 50 && amountNum <= maxAmount && destination.trim().length >= 3

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
      if      (code === 'INSUFFICIENT_BALANCE') setError('Saldo insuficiente.')
      else if (code === 'ACCOUNT_NOT_FOUND')    setError('Conta não encontrada.')
      else                                       setError('Erro ao solicitar retirada.')
    } finally {
      setSubmitting(false)
    }
  }

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
          {/* Amount */}
          <div>
            <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Valor (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="50,00"
              className="w-full bg-[#252a3a] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
            />
            <p className="text-[10px] text-[#8b8f9a] mt-1">
              Mínimo R$ 50,00 · Disponível R$ {formatBRL(maxAmount)}
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
          <p className="text-sm font-semibold text-white mb-4 md:mb-5">Conta:</p>
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
              disabled={balance < 50}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={balance < 50 ? 'Saldo insuficiente (mínimo R$50)' : 'Solicitar nova retirada'}
            >
              <Plus size={13} />
              Solicitar retirada
            </button>
          </div>

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
              <span className="text-xs text-[#8b8f9a]">Valor mínimo do depósito: <span className="text-green-400 font-semibold">R$50</span></span>
            </div>
            <div className="flex items-center gap-2">
              <Landmark size={13} className="text-green-400 flex-shrink-0" />
              <span className="text-xs text-[#8b8f9a]">Valor mínimo de retirada: <span className="text-green-400 font-semibold">R$50</span></span>
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

export function ContaPage({ initialTab = 'minha-conta' }: { initialTab?: ContaTab }) {
  const [activeTab, setActiveTab] = useState<ContaTab>(initialTab)

  return (
    <div className="flex-1 flex flex-col bg-[#151822] min-h-0 overflow-hidden">

      {/* Top tabs — horizontally scrollable on mobile */}
      <div className="flex items-center px-3 md:px-6 border-b border-[#2a2e3b] bg-[#1a1e2e] flex-shrink-0 gap-1 overflow-x-auto">
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

      {/* Currency selector — only shown on Minha Conta (other tabs no
          longer need a top info bar; balance lives in the page body). */}
      {activeTab === 'minha-conta' && (
        <div className="flex items-center gap-2 px-3 md:px-6 py-2 md:py-3 border-b border-[#2a2e3b] bg-[#1a1e2e] flex-shrink-0">
          <span className="text-xs text-[#8b8f9a]">Minha moeda atual</span>
          <span className="text-sm font-bold text-white">R$ BRL</span>
          <button className="text-[10px] font-bold bg-blue-500 text-white px-2 py-0.5 rounded">MUDAR</button>
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'retirada' && <RetiradaTab />}
      {activeTab === 'transacoes' && <TransacoesTab />}
      {activeTab === 'operacoes' && <OperacoesTab />}

      {activeTab === 'minha-conta' && (
        <div className="flex-1 overflow-y-auto">
          <div className="flex gap-0 h-full">

            {/* Left — Dados pessoais */}
            <div className="flex-1 max-w-[540px] px-8 py-6 border-r border-[#2a2e3b]">
              <p className="text-sm font-semibold text-white mb-5">Dados pessoais:</p>

              <div className="flex items-center gap-4 mb-6">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 border-2 border-blue-500/40 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-9 h-9 text-blue-400 fill-current">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                    </svg>
                  </div>
                  <button className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[#2a2e3b] border border-[#3a3f50] flex items-center justify-center hover:bg-[#3a3f50] transition-colors">
                    <Camera size={11} className="text-[#8b8f9a]" />
                  </button>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">janielmadeira@gmail.com</div>
                  <div className="text-xs text-[#8b8f9a] mt-0.5">ID: 10000001</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <CheckCircle2 size={12} className="text-green-400" />
                    <span className="text-xs font-semibold text-green-400">Verificado</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <FloatingInput label="Apelido" value="Janiel" />
                <FloatingInput label="Nome" value="Janiel" />
                <FloatingInput label="Sobrenome" value="Madeira" />
                <FloatingInput label="Data de nascimento" value="" />
                <FloatingInput label="CPF" value="" />
                <FloatingInput label="Email" value="janielmadeira@gmail.com" rightLabel="Verificado" />
                <FloatingSelect label="País" value="Brasil" />
                <FloatingInput label="Endereço" value="" />
              </div>

              <button className="mt-5 w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm font-bold text-white">
                Salvar
              </button>
            </div>

            {/* Middle — Segurança */}
            <div className="flex-1 max-w-[480px] px-8 py-6 border-r border-[#2a2e3b]">
              <p className="text-sm font-semibold text-white mb-5">Segurança:</p>

              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-white">Verificação em duas etapas</span>
                </div>
                <div className="flex items-center gap-2 ml-6">
                  <span className="text-xs text-[#8b8f9a]">Recebimento de códigos por email</span>
                  <button className="text-[#8b8f9a] hover:text-white transition-colors">
                    <Pencil size={11} />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4 mb-6">
                <Toggle label="Para entrar na plataforma" defaultOn={true} />
                <Toggle label="Para retirar fundos" defaultOn={true} />
              </div>

              <div className="border-t border-[#2a2e3b] pt-5">
                <div className="flex items-start gap-3">
                  <Lock size={16} className="text-[#8b8f9a] mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-white mb-0.5">Senha</div>
                    <div className="text-xs text-[#8b8f9a] mb-1.5">Alterar a senha da sua conta</div>
                    <button className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors">
                      Mudar
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right — Idioma + Fuso + Excluir */}
            <div className="flex-1 px-8 py-6">
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
      )}

      {activeTab === 'analise' && <AnalisePage />}

      {activeTab !== 'minha-conta' && activeTab !== 'retirada' && activeTab !== 'transacoes' && activeTab !== 'operacoes' && activeTab !== 'analise' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[#8b8f9a]">Em breve</p>
        </div>
      )}

    </div>
  )
}
