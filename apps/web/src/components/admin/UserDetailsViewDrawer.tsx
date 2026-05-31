'use client'

// /admin/operacoes → clique no Nome/Email abre este drawer (read-only).
//
// Distinto do UserDetailDrawer (que e' um formulario de edicao). Esse
// aqui mostra:
//   - 4 KPIs no topo (Saldo Operacional, Total Ganho, Total Perdido,
//     Total Depositado)
//   - Botoes "Logar como Usuario" + "Excluir Todos os Trades"
//   - Tabela de Historico de Operacoes (ate as 50 mais recentes)
//
// Reusa GET /admin/users/:id (mesmo endpoint usado pelo edit drawer) pra
// nao multiplicar round-trips. Calcula KPIs no frontend a partir das
// accounts/operations/transactions retornadas.

import { useEffect, useState } from 'react'
import {
  X, ArrowUp, ArrowDown, ExternalLink, Trash2, Loader2,
  TrendingDown, TrendingUp, DollarSign,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface UserDetailsResponse {
  user: {
    id:    string
    name:  string
    email: string
  }
  accounts: Array<{
    id:      string
    type:    'REAL' | 'DEMO'
    balance: string
  }>
  operations: Array<{
    id:           string
    assetSymbol:  string
    direction:    'CALL' | 'PUT'
    amount:       string
    entryPrice:   string
    exitPrice:    string | null
    profit:       string | null
    status:       'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
    openedAt:     string
  }>
  transactions: Array<{
    id:          string
    type:        string         // DEPOSIT, WITHDRAWAL, BUY, PROFIT, etc.
    amount:      string
    description: string | null
    createdAt:   string
  }>
}

interface Props {
  userId:    string
  onClose:   () => void
  /** Chamado se algum trade for excluido pra refetch da lista de fora. */
  onChanged?: () => void
}

export function UserDetailsViewDrawer({ userId, onClose, onChanged }: Props) {
  const [data, setData]       = useState<UserDetailsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // ESC fecha (pattern do UserDetailDrawer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    api.get<UserDetailsResponse>(`/admin/users/${userId}`)
      .then(res => { if (alive) setData(res.data) })
      .catch(() => { if (alive) setError('Erro ao carregar detalhes.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [userId])

  // ── KPIs calculados ───────────────────────────────────────────────────
  // realAccount: pode nao existir se o user nunca abriu conta REAL — fallback 0.
  // Numbers via parseFloat porque o backend serializa Decimal como string.
  const realAccount    = data?.accounts.find(a => a.type === 'REAL')
  const saldoOpera     = parseFloat(realAccount?.balance ?? '0')
  const totalGanho     = (data?.operations ?? [])
    .filter(o => o.status === 'WON')
    .reduce((sum, o) => sum + parseFloat(o.profit ?? '0'), 0)
  const totalPerdido   = (data?.operations ?? [])
    .filter(o => o.status === 'LOST')
    .reduce((sum, o) => sum + parseFloat(o.amount), 0)
  const totalDepositado = (data?.transactions ?? [])
    .filter(t => t.type === 'DEPOSIT')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0)

  return (
    // Drawer slide-in da DIREITA — mesmo pattern do UserDetailDrawer pra
    // consistencia visual. items-stretch faz o painel ocupar 100% altura;
    // justify-end gruda na direita; click no overlay fora dele fecha.
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[920px] h-full bg-[#0e1116] border-l border-[#1f232e] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f232e]">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">
              Detalhes do Usuário: {(data?.user.name ?? '—').toUpperCase()}
            </h2>
            <div className="text-xs text-[#8b8f9a] mt-0.5 truncate">{data?.user.email}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => alert('Logar como usuário — em breve.')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#13161f] text-xs font-semibold text-white hover:bg-white/5 transition-colors"
              title="Abrir uma sessão como este usuário (em breve)"
            >
              <ExternalLink size={13} />
              Logar como Usuário
            </button>
            <button onClick={onClose} className="text-[#8b8f9a] hover:text-white p-1">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-20 text-sm text-[#8b8f9a]">
              <Loader2 className="animate-spin mr-2" size={16} /> Carregando…
            </div>
          )}
          {error && !loading && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}
          {data && !loading && !error && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <KpiCard
                  label="Saldo Operacional"
                  value={fmtBRL(saldoOpera)}
                  tone={saldoOpera >= 0 ? 'neutral' : 'red'}
                  icon={<TrendingDown size={14} />}
                />
                <KpiCard
                  label="Total Ganho"
                  value={fmtBRL(totalGanho)}
                  tone="green"
                  icon={<TrendingUp size={14} />}
                />
                <KpiCard
                  label="Total Perdido"
                  value={fmtBRL(totalPerdido)}
                  tone="red"
                  icon={<TrendingDown size={14} />}
                />
                <KpiCard
                  label="Total Depositado"
                  value={fmtBRL(totalDepositado)}
                  tone="neutral"
                  icon={<DollarSign size={14} />}
                />
              </div>

              {/* Histórico de Operações */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">Histórico de Operações</h3>
                <button
                  onClick={() => alert('Excluir todos os trades — em breve.')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
                  title="Excluir TODAS as operações deste usuário (em breve)"
                >
                  <Trash2 size={12} />
                  Excluir Todos os Trades
                </button>
              </div>

              <div className="bg-[#13161f] border border-[#1f232e] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#1f232e] text-[10px] text-[#8b8f9a] font-bold uppercase tracking-wide">
                        <th className="text-left  px-3 py-3">Data</th>
                        <th className="text-left  px-3 py-3">Ativo</th>
                        <th className="text-left  px-3 py-3">Direção</th>
                        <th className="text-right px-3 py-3">Valor</th>
                        <th className="text-right px-3 py-3">Entrada</th>
                        <th className="text-right px-3 py-3">Saída</th>
                        <th className="text-left  px-3 py-3">Resultado</th>
                        <th className="text-right px-3 py-3">Lucro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.operations.length === 0 ? (
                        <tr><td colSpan={8} className="py-10 text-center text-[#8b8f9a]">Nenhuma operação encontrada.</td></tr>
                      ) : (
                        data.operations.map(op => {
                          const isUp   = op.direction === 'CALL'
                          const stake  = parseFloat(op.amount)
                          const profit = parseFloat(op.profit ?? '0')
                          const pnl    =
                            op.status === 'WON'  ? profit :
                            op.status === 'LOST' ? -stake :
                            null
                          return (
                            <tr key={op.id} className="border-b border-[#1f232e]/40 hover:bg-white/[0.02]">
                              <td className="px-3 py-2.5 text-[#8b8f9a]">{formatDate(op.openedAt)}</td>
                              <td className="px-3 py-2.5 text-white font-mono">{op.assetSymbol}</td>
                              <td className="px-3 py-2.5">
                                <span className={cn(
                                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit',
                                  isUp
                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                                    : 'bg-red-500/15 text-red-400 border-red-500/40'
                                )}>
                                  {isUp ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                                  {isUp ? 'Acima' : 'Abaixo'}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right text-white">R$ {fmtBRL(stake)}</td>
                              <td className="px-3 py-2.5 text-right text-white font-mono">{op.entryPrice}</td>
                              <td className="px-3 py-2.5 text-right text-white font-mono">{op.exitPrice ?? '—'}</td>
                              <td className="px-3 py-2.5">
                                {op.status === 'OPEN' && (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border bg-yellow-500/15 text-yellow-400 border-yellow-500/40">
                                    Aguardando
                                  </span>
                                )}
                                {op.status === 'WON' && (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-500/15 text-emerald-400 border-emerald-500/40">
                                    Ganhou
                                  </span>
                                )}
                                {op.status === 'LOST' && (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border bg-red-500/15 text-red-400 border-red-500/40">
                                    Perdeu
                                  </span>
                                )}
                                {op.status === 'CANCELLED' && (
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border bg-[#1a1e2a] text-[#8b8f9a] border-[#1f232e]">
                                    Cancelada
                                  </span>
                                )}
                              </td>
                              <td className={cn('px-3 py-2.5 text-right font-semibold',
                                pnl == null ? 'text-[#8b8f9a]' : pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}R$ ${fmtBRL(Math.abs(pnl))}`}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {data.operations.length === 50 && (
                <div className="mt-3 text-[11px] text-[#8b8f9a] text-center">
                  Mostrando as 50 operações mais recentes. Pra ver todas, use a página de Operações com filtro de email.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────

function KpiCard({ label, value, tone, icon }: {
  label: string
  value: string
  tone:  'green' | 'red' | 'neutral'
  icon:  React.ReactNode
}) {
  const toneClasses = {
    green:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    red:     'bg-red-500/10     text-red-400     border-red-500/30',
    neutral: 'bg-[#1a1e2a]      text-white       border-[#1f232e]',
  }
  return (
    <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn('w-6 h-6 rounded-md border flex items-center justify-center', toneClasses[tone])}>
          {icon}
        </div>
        <div className="text-[11px] text-[#8b8f9a]">{label}</div>
      </div>
      <div className={cn('text-lg font-bold',
        tone === 'green' ? 'text-emerald-400' :
        tone === 'red'   ? 'text-red-400'     : 'text-white')}>
        R$ {value}
      </div>
    </div>
  )
}

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}
