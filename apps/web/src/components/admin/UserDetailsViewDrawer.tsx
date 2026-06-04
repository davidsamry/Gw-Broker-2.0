'use client'

// /admin/operacoes → clique no Nome/Email abre este drawer (read-only).
//
// Distinto do UserDetailDrawer (que e' um formulario de edicao). Esse
// aqui mostra:
//   - 4 KPIs no topo (Saldo Operacional, Total Ganho, Total Perdido,
//     Total Depositado)
//   - Botoes "Logar como Usuario" + "Excluir Todos os Trades"
//   - Tabela de Historico de Operacoes paginada (25/pagina)
//
// Faz 2 requests em paralelo:
//   - GET /admin/users/:id   → dados do user + KPIs (accounts + transactions)
//   - GET /admin/operations?userId=:id&page=X → historico paginado
//
// A separacao permite paginacao real (em vez de ficar limitado a 50 ops
// que o /admin/users/:id retorna). Page muda → so a 2a request roda.

import { useCallback, useEffect, useState } from 'react'
import {
  X, ArrowUp, ArrowDown, ExternalLink, Trash2, Loader2,
  TrendingDown, TrendingUp, DollarSign,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface UserSummary {
  user: {
    id:    string
    name:  string
    email: string
  }
  accounts: Array<{
    id:               string
    type:             'REAL' | 'DEMO'
    balance:          string
    bonusBalance?:    string
    rolloverRequired?: string
    rolloverProgress?: string
  }>
  // Inclui ops + transactions usados pros KPIs (sem precisar paginar).
  operations: Array<{
    status: 'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
    amount: string
    profit: string | null
  }>
  transactions: Array<{
    type:   string         // DEPOSIT, WITHDRAWAL, BUY, PROFIT, etc.
    amount: string
  }>
}

interface OperationRow {
  id:           string
  assetSymbol:  string
  direction:    'CALL' | 'PUT'
  amount:       string
  entryPrice:   string
  exitPrice:    string | null
  profit:       string | null
  status:       'OPEN' | 'WON' | 'LOST' | 'CANCELLED'
  openedAt:     string
}

interface OpsListResponse {
  operations: OperationRow[]
  total:      number
  page:       number
  pageSize:   number
}

interface Props {
  userId:    string
  onClose:   () => void
  /** Chamado se algum trade for excluido pra refetch da lista de fora. */
  onChanged?: () => void
}

const PAGE_SIZE = 25

export function UserDetailsViewDrawer({ userId, onClose, onChanged }: Props) {
  // Summary (KPIs + user info) — buscado uma vez por userId
  const [summary, setSummary] = useState<UserSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError]   = useState('')

  // Operations paginadas — refetch quando page muda
  const [ops, setOps]         = useState<OpsListResponse | null>(null)
  const [opsLoading, setOpsLoading] = useState(true)
  const [opsError, setOpsError]     = useState('')
  const [page, setPage]       = useState(1)

  // Estado do botao "Excluir Todos"
  const [deletingAll, setDeletingAll] = useState(false)
  // Estado do botao "Logar como Usuario"
  const [impersonating, setImpersonating] = useState(false)
  // Rollover editavel — input controlado + flag salvando
  const [rolloverDraft, setRolloverDraft] = useState('')
  const [savingRollover, setSavingRollover] = useState(false)

  // ESC fecha (pattern do UserDetailDrawer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Carrega summary (1 vez por userId) ─────────────────────────────────
  useEffect(() => {
    let alive = true
    setSummaryLoading(true); setSummaryError('')
    api.get<UserSummary>(`/admin/users/${userId}`)
      .then(res => { if (alive) setSummary(res.data) })
      .catch(() => { if (alive) setSummaryError('Erro ao carregar dados do usuário.') })
      .finally(() => { if (alive) setSummaryLoading(false) })
    return () => { alive = false }
  }, [userId])

  // ── Carrega operations paginadas ───────────────────────────────────────
  const loadOps = useCallback(async () => {
    setOpsLoading(true); setOpsError('')
    try {
      const res = await api.get<OpsListResponse>('/admin/operations', {
        params: { userId, page, pageSize: PAGE_SIZE },
      })
      setOps(res.data)
    } catch {
      setOpsError('Erro ao carregar histórico.')
    } finally {
      setOpsLoading(false)
    }
  }, [userId, page])
  useEffect(() => { loadOps() }, [loadOps])

  // ── Handler: logar como usuario (impersonation) ────────────────────────
  // Flow:
  //   1. POST /admin/users/:id/impersonate → recebe { token, user }
  //   2. Abre nova aba em /admin/impersonate#t=TOKEN&u=email
  //      (hash, NAO query — token nao vaza em logs de proxy)
  //   3. A pagina /admin/impersonate salva o token em sessionStorage
  //      (por aba, preserva sessao do admin na aba original) e redireciona
  //      pra '/'. O Banner global vermelho aparece em TODA tela alertando.
  async function handleImpersonate() {
    if (impersonating || !summary) return
    setImpersonating(true)
    try {
      const res = await api.post<{
        token: string
        user:  { id: string; name: string; email: string }
        expiresIn: number
      }>(`/admin/users/${userId}/impersonate`)
      const { token, user } = res.data
      // window.open com hash — fragmento NAO e enviado pro servidor
      const url = `/admin/impersonate#t=${encodeURIComponent(token)}&u=${encodeURIComponent(user.email)}`
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        alert('Bloqueador de popup impediu a abertura da nova aba. Permita popups e tente de novo.')
        return
      }
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'CANNOT_IMPERSONATE_ADMIN') alert('Não é possível impersonar outro ADMIN. Rebaixe ele pra USER primeiro.')
      else if (code === 'CANNOT_IMPERSONATE_SELF')  alert('Você não pode impersonar a si próprio.')
      else if (code === 'USER_BLOCKED')             alert('Usuário está bloqueado — não dá pra impersonar.')
      else if (code === 'USER_NOT_FOUND')           alert('Usuário não encontrado.')
      else                                          alert('Erro ao gerar impersonação. Veja os logs da API.')
    } finally {
      setImpersonating(false)
    }
  }

  // ── Handler: excluir todos os trades ───────────────────────────────────
  async function handleDeleteAll() {
    if (!summary) return
    const count = (summary.operations ?? []).length
    if (count === 0) {
      alert('Este usuário não tem operações pra excluir.')
      return
    }
    // Dupla confirmacao porque e' destrutivo e reverte saldo
    const first = confirm(
      `EXCLUIR TODAS AS OPERAÇÕES de ${summary.user.email}?\n\n` +
      `Isso vai:\n` +
      `  • Apagar TODO o histórico de operações deste usuário\n` +
      `  • Reverter o saldo das contas (devolver stakes, estornar lucros pagos)\n` +
      `  • Registrar entradas de ADJUSTMENT no extrato\n\n` +
      `Não pode ser desfeito.`
    )
    if (!first) return
    const second = prompt(
      `Pra confirmar, digite EXCLUIR (maiúsculo):`,
      ''
    )
    if (second !== 'EXCLUIR') {
      alert('Cancelado — confirmação não correspondeu.')
      return
    }
    setDeletingAll(true)
    try {
      const res = await api.delete<{
        ok: boolean; deletedCount: number; totalBalanceDelta: string
      }>(`/admin/users/${userId}/operations`)
      alert(
        `${res.data.deletedCount} operações excluídas.\n` +
        `Saldo ajustado em R$ ${res.data.totalBalanceDelta}.`
      )
      // Refetch tudo
      await loadOps()
      // Re-buscar summary pra atualizar KPIs (saldo e totais)
      const sres = await api.get<UserSummary>(`/admin/users/${userId}`)
      setSummary(sres.data)
      onChanged?.()
    } catch (err: any) {
      console.error(err)
      alert('Erro ao excluir trades. Verifique os logs da API.')
    } finally {
      setDeletingAll(false)
    }
  }

  // ── KPIs calculados ───────────────────────────────────────────────────
  const realAccount     = summary?.accounts.find(a => a.type === 'REAL')
  const saldoOpera      = parseFloat(realAccount?.balance ?? '0')
  const bonusBal        = parseFloat(realAccount?.bonusBalance ?? '0')
  const rolloverReq     = parseFloat(realAccount?.rolloverRequired ?? '0')
  const rolloverProg    = parseFloat(realAccount?.rolloverProgress ?? '0')
  const totalGanho     = (summary?.operations ?? [])
    .filter(o => o.status === 'WON')
    .reduce((sum, o) => sum + parseFloat(o.profit ?? '0'), 0)
  const totalPerdido   = (summary?.operations ?? [])
    .filter(o => o.status === 'LOST')
    .reduce((sum, o) => sum + parseFloat(o.amount), 0)
  const totalDepositado = (summary?.transactions ?? [])
    .filter(t => t.type === 'DEPOSIT')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0)
  // Lucro liquido = saldo atual (balance principal) - total depositado.
  // Bonus NAO entra na conta (e' dinheiro da plataforma com rollover).
  const lucroLiquido = saldoOpera - totalDepositado

  // Hidrata o draft do rollover quando o summary carrega ou muda.
  useEffect(() => {
    if (realAccount?.rolloverRequired != null) {
      setRolloverDraft(realAccount.rolloverRequired)
    }
  }, [realAccount?.rolloverRequired])

  // Handler: PATCH /admin/users/:id { rolloverRequired }
  async function saveRollover() {
    const value = parseFloat(rolloverDraft)
    if (!isFinite(value) || value < 0) {
      alert('Rollover invalido — informe um numero >= 0')
      return
    }
    setSavingRollover(true)
    try {
      await api.patch(`/admin/users/${userId}`, { rolloverRequired: value })
      // Re-busca summary pra refletir o valor novo
      const sres = await api.get<UserSummary>(`/admin/users/${userId}`)
      setSummary(sres.data)
      onChanged?.()
    } catch {
      alert('Erro ao salvar rollover.')
    } finally {
      setSavingRollover(false)
    }
  }

  const totalPages = ops ? Math.max(1, Math.ceil(ops.total / PAGE_SIZE)) : 1

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1000px] h-full bg-[#0e1116] border-l border-[#1f232e] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f232e]">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">
              Detalhes do Usuário: {(summary?.user.name ?? '—').toUpperCase()}
            </h2>
            <div className="text-xs text-[#8b8f9a] mt-0.5 truncate">{summary?.user.email}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleImpersonate}
              disabled={impersonating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Abrir uma nova aba logado como este usuário (token expira em 30min)"
            >
              {impersonating ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
              {impersonating ? 'Gerando…' : 'Logar como Usuário'}
            </button>
            <button onClick={onClose} className="text-[#8b8f9a] hover:text-white p-1">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {summaryLoading && (
            <div className="flex items-center justify-center py-20 text-sm text-[#8b8f9a]">
              <Loader2 className="animate-spin mr-2" size={16} /> Carregando…
            </div>
          )}
          {summaryError && !summaryLoading && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {summaryError}
            </div>
          )}
          {summary && !summaryLoading && !summaryError && (
            <>
              {/* KPIs — 6 cards no total. Em desktop fica 3 colunas x 2 linhas. */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                <KpiCard
                  label="Valor Depositado"
                  value={fmtBRL(totalDepositado)}
                  tone="neutral"
                  icon={<DollarSign size={14} />}
                />
                <KpiCard
                  label="Saldo Atual"
                  value={fmtBRL(saldoOpera)}
                  tone={saldoOpera >= 0 ? 'neutral' : 'red'}
                  icon={<TrendingUp size={14} />}
                  hint={bonusBal > 0 ? `+ R\$ ${fmtBRL(bonusBal)} bonus` : undefined}
                />
                <KpiCard
                  label="Lucro Liquido"
                  value={`${lucroLiquido >= 0 ? '+' : ''}${fmtBRL(lucroLiquido)}`}
                  tone={lucroLiquido >= 0 ? 'green' : 'red'}
                  icon={lucroLiquido >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
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
                {/* Rollover EDITAVEL — admin pode forcar um valor especifico
                    (ex: zerar pra liberar saque, aumentar pra travar). */}
                <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#8b8f9a] font-medium uppercase tracking-wide">Rollover (R$)</span>
                    <DollarSign size={14} className="text-blue-400" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={rolloverDraft}
                      onChange={(e) => setRolloverDraft(e.target.value)}
                      className="flex-1 min-w-0 bg-[#0f1117] border border-[#1f232e] rounded px-2 py-1 text-sm font-bold text-white outline-none focus:border-blue-500/60"
                    />
                    <button
                      onClick={saveRollover}
                      disabled={savingRollover || rolloverDraft === (realAccount?.rolloverRequired ?? '')}
                      className="px-2 py-1 rounded bg-blue-500/15 border border-blue-500/40 text-[10px] font-bold text-blue-400 hover:bg-blue-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {savingRollover ? '...' : 'Salvar'}
                    </button>
                  </div>
                  <div className="text-[10px] text-[#8b8f9a]">
                    Progresso: <span className="text-white font-semibold">R$ {fmtBRL(rolloverProg)}</span> / R$ {fmtBRL(rolloverReq)}
                  </div>
                </div>
              </div>

              {/* Header da tabela */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">Histórico de Operações</h3>
                <button
                  onClick={handleDeleteAll}
                  disabled={deletingAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Excluir TODAS as operações deste usuário (reverte saldo)"
                >
                  {deletingAll ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {deletingAll ? 'Excluindo…' : 'Excluir Todos os Trades'}
                </button>
              </div>

              {/* Tabela paginada */}
              <div className="bg-[#13161f] border border-[#1f232e] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#1f232e] text-[10px] text-[#8b8f9a] font-bold uppercase tracking-wide">
                        <th className="text-left  px-3 py-3">Data</th>
                        <th className="text-left  px-3 py-3">Horário</th>
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
                      {opsLoading && !ops ? (
                        <tr><td colSpan={9} className="py-10 text-center text-[#8b8f9a]">
                          <Loader2 className="inline animate-spin mr-2" size={14} /> Carregando…
                        </td></tr>
                      ) : opsError ? (
                        <tr><td colSpan={9} className="py-10 text-center text-red-400">{opsError}</td></tr>
                      ) : ops?.operations.length === 0 ? (
                        <tr><td colSpan={9} className="py-10 text-center text-[#8b8f9a]">Nenhuma operação encontrada.</td></tr>
                      ) : (
                        ops?.operations.map(op => {
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
                              <td className="px-3 py-2.5 text-[#8b8f9a] font-mono">{formatTime(op.openedAt)}</td>
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

                {/* Paginacao */}
                {ops && ops.total > PAGE_SIZE && (
                  <div className="flex items-center justify-between px-4 py-3 text-xs text-[#8b8f9a] border-t border-[#1f232e]">
                    <span>
                      Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ops.total)} de {ops.total}
                    </span>
                    <div className="flex items-center gap-1">
                      <Pager disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft size={14} /></Pager>
                      <Pager disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></Pager>
                      <span className="px-2 font-semibold text-white">{page} / {totalPages}</span>
                      <Pager disabled={page === totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></Pager>
                      <Pager disabled={page === totalPages} onClick={() => setPage(totalPages)}><ChevronsRight size={14} /></Pager>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────

function KpiCard({ label, value, tone, icon, hint }: {
  label: string
  value: string
  tone:  'green' | 'red' | 'neutral'
  icon:  React.ReactNode
  hint?: string
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
      {hint && <div className="text-[10px] text-yellow-400 mt-0.5">{hint}</div>}
    </div>
  )
}

function Pager({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="w-7 h-7 flex items-center justify-center rounded border border-[#1f232e] text-[#8b8f9a] hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
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

function formatTime(iso: string): string {
  const d  = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mi}:${ss}`
}
