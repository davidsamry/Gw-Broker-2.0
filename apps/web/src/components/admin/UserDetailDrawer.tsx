'use client'

import { useEffect, useState } from 'react'
import {
  X, Mail, Calendar, Phone, MapPin, FileText, ShieldCheck, ShieldAlert,
  Wallet, Activity, Receipt, ArrowDownToLine, Plus, Minus, AlertCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth'

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
    createdAt: string
  }
  accounts:     Array<{ id: string; type: 'REAL' | 'DEMO'; balance: string; currency: string }>
  operations:   Array<{ id: string; assetSymbol: string; direction: string; amount: string; status: string; profit: string | null; openedAt: string; closedAt: string | null }>
  transactions: Array<{ id: string; type: string; amount: string; description: string | null; createdAt: string }>
  withdrawals:  Array<{ id: string; amount: string; method: string; status: string; createdAt: string }>
}

type Tab = 'overview' | 'contas' | 'operacoes' | 'transacoes'

interface Props {
  userId:    string
  onClose:   () => void
  onChanged: () => void  // parent reloads the list after a mutating action
}

// Slide-in drawer (right) with full user detail + admin actions.
// All admin mutations hit /admin/users/:id endpoints behind requireAdmin.
export function UserDetailDrawer({ userId, onClose, onChanged }: Props) {
  const [data, setData]       = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [tab, setTab]         = useState<Tab>('overview')

  // Action modals state
  const [blockModalOpen, setBlockModalOpen]     = useState(false)
  const [roleModalOpen, setRoleModalOpen]       = useState(false)
  const [balanceModalOpen, setBalanceModalOpen] = useState(false)

  const me = useAuthStore((s) => s.user)
  const isSelf = me?.id === userId

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<UserDetail>(`/admin/users/${userId}`)
      setData(res.data)
    } catch {
      setError('Erro ao carregar detalhe.')
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

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-stretch justify-end" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] h-full bg-[#0f1117] border-l border-[#1f232e] flex flex-col shadow-2xl shadow-black/40"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f232e] flex-shrink-0">
          <h2 className="text-sm font-bold text-white">Detalhes do usuário</h2>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={18} /></button>
        </div>

        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#8b8f9a]">
            {error || 'Carregando…'}
          </div>
        ) : (
          <>
            {/* User summary */}
            <div className="px-5 py-4 border-b border-[#1f232e]">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-sm font-bold flex-shrink-0">
                  {(data.user.name || data.user.email)[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-white truncate">{data.user.name || '—'}</div>
                  <div className="text-xs text-[#8b8f9a] truncate">{data.user.email}</div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {data.user.role === 'ADMIN' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/40">ADMIN</span>
                    )}
                    {data.user.blocked && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-400 border border-red-500/40">BLOQUEADO</span>
                    )}
                    {data.user.twoFactorEnabled && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/40">2FA</span>
                    )}
                    <span className="text-[10px] text-[#8b8f9a]">ID: {data.user.id.slice(0, 8).toUpperCase()}</span>
                  </div>
                </div>
              </div>

              {isSelf && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 mb-3">
                  <AlertCircle size={13} className="text-orange-400 flex-shrink-0" />
                  <span className="text-[11px] text-[#ccc]">Esta é a sua conta. Ações de bloqueio e despromoção estão desabilitadas.</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-2">
                <ActionBtn
                  label={data.user.blocked ? 'Desbloquear' : 'Bloquear'}
                  icon={data.user.blocked ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                  tone={data.user.blocked ? 'emerald' : 'red'}
                  disabled={isSelf}
                  onClick={() => setBlockModalOpen(true)}
                />
                <ActionBtn
                  label={data.user.role === 'ADMIN' ? 'Remover ADMIN' : 'Tornar ADMIN'}
                  icon={<ShieldCheck size={13} />}
                  tone={data.user.role === 'ADMIN' ? 'red' : 'emerald'}
                  disabled={isSelf && data.user.role === 'ADMIN'}
                  onClick={() => setRoleModalOpen(true)}
                />
                <ActionBtn
                  label="Ajustar saldo"
                  icon={<Wallet size={13} />}
                  tone="blue"
                  onClick={() => setBalanceModalOpen(true)}
                />
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-[#1f232e] flex-shrink-0 px-2">
              <TabBtn active={tab === 'overview'}   onClick={() => setTab('overview')}>Visão geral</TabBtn>
              <TabBtn active={tab === 'contas'}     onClick={() => setTab('contas')}>Contas ({data.accounts.length})</TabBtn>
              <TabBtn active={tab === 'operacoes'}  onClick={() => setTab('operacoes')}>Operações ({data.operations.length})</TabBtn>
              <TabBtn active={tab === 'transacoes'} onClick={() => setTab('transacoes')}>Ledger ({data.transactions.length})</TabBtn>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === 'overview'   && <OverviewTab user={data.user} />}
              {tab === 'contas'     && <ContasTab   accounts={data.accounts} />}
              {tab === 'operacoes'  && <OperacoesTab ops={data.operations} />}
              {tab === 'transacoes' && <TransacoesTab txs={data.transactions} />}
            </div>
          </>
        )}

        {/* Action modals */}
        {data && blockModalOpen && (
          <BlockModal
            user={data.user}
            onClose={() => setBlockModalOpen(false)}
            onDone={async () => { await load(); onChanged(); setBlockModalOpen(false) }}
          />
        )}
        {data && roleModalOpen && (
          <RoleModal
            user={data.user}
            onClose={() => setRoleModalOpen(false)}
            onDone={async () => { await load(); onChanged(); setRoleModalOpen(false) }}
          />
        )}
        {data && balanceModalOpen && (
          <BalanceModal
            user={data.user}
            accounts={data.accounts}
            onClose={() => setBalanceModalOpen(false)}
            onDone={async () => { await load(); onChanged(); setBalanceModalOpen(false) }}
          />
        )}
      </aside>
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function ActionBtn({
  label, icon, tone, onClick, disabled,
}: { label: string; icon: React.ReactNode; tone: 'emerald' | 'red' | 'blue'; onClick: () => void; disabled?: boolean }) {
  const toneCls = {
    emerald: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20',
    red:     'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20',
    blue:    'bg-blue-500/10 border-blue-500/40 text-blue-400 hover:bg-blue-500/20',
  }[tone]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
        toneCls,
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
        active ? 'text-white border-emerald-400 font-semibold' : 'text-[#8b8f9a] border-transparent hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

function OverviewTab({ user }: { user: UserDetail['user'] }) {
  const rows: Array<[React.ReactNode, string, string | null]> = [
    [<Mail     size={13} key="m" />, 'Email',         user.email],
    [<FileText size={13} key="c" />, 'CPF',           user.cpf],
    [<Calendar size={13} key="b" />, 'Nascimento',    user.birthDate],
    [<Phone    size={13} key="p" />, 'Telefone',      user.phone],
    [<MapPin   size={13} key="o" />, 'País',          user.country],
    [<MapPin   size={13} key="a" />, 'Endereço',      user.address],
    [<Calendar size={13} key="r" />, 'Cadastrado em', new Date(user.createdAt).toLocaleString('pt-BR')],
  ]
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([icon, label, value]) => (
        <div key={label} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-[#13161f] border border-[#1f232e]">
          <span className="text-[#8b8f9a] mt-0.5">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#8b8f9a]">{label}</div>
            <div className="text-xs text-white truncate">{value || '—'}</div>
          </div>
        </div>
      ))}
      {user.blocked && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 mt-1">
          <div className="text-[10px] font-bold text-red-400 mb-1">BLOQUEADO</div>
          <div className="text-xs text-[#ccc]">{user.blockedReason || 'Sem motivo informado'}</div>
          {user.blockedAt && <div className="text-[10px] text-[#8b8f9a] mt-1">em {new Date(user.blockedAt).toLocaleString('pt-BR')}</div>}
        </div>
      )}
    </div>
  )
}

function ContasTab({ accounts }: { accounts: UserDetail['accounts'] }) {
  if (accounts.length === 0) return <EmptyTab icon={<Wallet size={18} />} text="Sem contas." />
  return (
    <div className="flex flex-col gap-2">
      {accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-[#13161f] border border-[#1f232e]">
          <div>
            <div className="text-xs font-bold text-white">{a.type === 'REAL' ? 'Conta Real' : 'Conta Demo'}</div>
            <div className="text-[10px] text-[#8b8f9a] font-mono">{a.id.slice(0, 12).toUpperCase()}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-white">R$ {fmtBRL(a.balance)}</div>
            <div className="text-[10px] text-[#8b8f9a]">{a.currency}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function OperacoesTab({ ops }: { ops: UserDetail['operations'] }) {
  if (ops.length === 0) return <EmptyTab icon={<Activity size={18} />} text="Sem operações." />
  return (
    <div className="flex flex-col gap-1">
      {ops.map((o) => (
        <div key={o.id} className="grid grid-cols-[1fr_70px_80px_80px] gap-2 px-3 py-2 rounded bg-[#13161f] border border-[#1f232e]/50 items-center">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">{o.assetSymbol}</div>
            <div className="text-[10px] text-[#8b8f9a]">{new Date(o.openedAt).toLocaleString('pt-BR')}</div>
          </div>
          <span className={cn('text-[10px] font-semibold', o.direction === 'CALL' ? 'text-emerald-400' : 'text-red-400')}>
            {o.direction}
          </span>
          <span className={cn('text-xs font-semibold text-right',
            o.status === 'WON' ? 'text-emerald-400' :
            o.status === 'LOST' ? 'text-red-400' : 'text-[#8b8f9a]')}>
            {o.status}
          </span>
          <span className="text-xs text-white text-right">R$ {fmtBRL(o.amount)}</span>
        </div>
      ))}
    </div>
  )
}

function TransacoesTab({ txs }: { txs: UserDetail['transactions'] }) {
  if (txs.length === 0) return <EmptyTab icon={<Receipt size={18} />} text="Sem transações." />
  return (
    <div className="flex flex-col gap-1">
      {txs.map((t) => {
        const v = parseFloat(t.amount)
        const neg = v < 0
        return (
          <div key={t.id} className="px-3 py-2 rounded bg-[#13161f] border border-[#1f232e]/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">{t.type}</span>
              <span className={cn('text-xs font-bold', neg ? 'text-red-400' : 'text-emerald-400')}>
                {neg ? '' : '+'}R$ {fmtBRL(t.amount)}
              </span>
            </div>
            <div className="text-[10px] text-[#8b8f9a] mt-1">
              {new Date(t.createdAt).toLocaleString('pt-BR')}
              {t.description && <> · {t.description}</>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EmptyTab({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#8b8f9a]">
      <div className="w-10 h-10 rounded-full bg-[#13161f] border border-[#1f232e] flex items-center justify-center">{icon}</div>
      <p className="text-xs">{text}</p>
    </div>
  )
}

// ── Action modals ───────────────────────────────────────────────────────────

function BlockModal({ user, onClose, onDone }: { user: UserDetail['user']; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(user.blockedReason ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const willBlock = !user.blocked

  async function submit() {
    setLoading(true); setError('')
    try {
      await api.patch(`/admin/users/${user.id}`, {
        blocked:       willBlock,
        blockedReason: willBlock ? reason.trim() || null : null,
      })
      onDone()
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'SELF_LOCKOUT_PROTECTED') setError('Você não pode bloquear a si mesmo.')
      else                                    setError('Erro ao atualizar.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title={willBlock ? 'Bloquear usuário' : 'Desbloquear usuário'} onClose={onClose}>
      <p className="text-xs text-[#ccc] leading-relaxed mb-3">
        {willBlock
          ? `Bloquear "${user.email}" impede novos logins. Sessões existentes expiram em até 15 min.`
          : `Reativar "${user.email}". O usuário poderá fazer login novamente.`}
      </p>
      {willBlock && (
        <div className="mb-3">
          <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Motivo (opcional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: tentativa de fraude, KYC inválido..."
            rows={2}
            className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/60 resize-none"
          />
        </div>
      )}
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white">Cancelar</button>
        <button onClick={submit} disabled={loading} className={cn('flex-1 h-9 rounded-lg text-xs font-bold transition-colors disabled:opacity-50',
          willBlock ? 'bg-red-500 hover:bg-red-400 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-black')}>
          {loading ? '...' : willBlock ? 'Bloquear' : 'Desbloquear'}
        </button>
      </div>
    </Modal>
  )
}

function RoleModal({ user, onClose, onDone }: { user: UserDetail['user']; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const newRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN'

  async function submit() {
    setLoading(true); setError('')
    try {
      await api.patch(`/admin/users/${user.id}`, { role: newRole })
      onDone()
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'SELF_LOCKOUT_PROTECTED') setError('Você não pode remover seu próprio ADMIN.')
      else                                    setError('Erro ao atualizar.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title={newRole === 'ADMIN' ? 'Tornar ADMIN' : 'Remover ADMIN'} onClose={onClose}>
      <p className="text-xs text-[#ccc] leading-relaxed mb-4">
        {newRole === 'ADMIN'
          ? `"${user.email}" terá acesso total ao painel admin. Precisará configurar 2FA no próximo login.`
          : `"${user.email}" perderá o acesso ao painel admin imediatamente.`}
      </p>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white">Cancelar</button>
        <button onClick={submit} disabled={loading} className={cn('flex-1 h-9 rounded-lg text-xs font-bold transition-colors disabled:opacity-50',
          newRole === 'ADMIN' ? 'bg-emerald-500 hover:bg-emerald-400 text-black' : 'bg-red-500 hover:bg-red-400 text-white')}>
          {loading ? '...' : 'Confirmar'}
        </button>
      </div>
    </Modal>
  )
}

function BalanceModal({ user, accounts, onClose, onDone }: { user: UserDetail['user']; accounts: UserDetail['accounts']; onClose: () => void; onDone: () => void }) {
  const [accountType, setAccountType] = useState<'REAL' | 'DEMO'>('REAL')
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const acct  = accounts.find((a) => a.type === accountType)
  const value = parseFloat(amount.replace(',', '.')) || 0
  const valid = value > 0 && reason.trim().length >= 3 && !!acct

  async function submit() {
    if (!valid) return
    setLoading(true); setError('')
    try {
      await api.post(`/admin/users/${user.id}/balance`, {
        accountType,
        amount: direction === 'credit' ? value : -value,
        reason: reason.trim(),
      })
      onDone()
    } catch (err: any) {
      const code = err?.response?.data?.error
      if      (code === 'INSUFFICIENT_BALANCE') setError('Saldo insuficiente para o débito.')
      else if (code === 'ACCOUNT_NOT_FOUND')    setError('Conta não encontrada.')
      else                                       setError('Erro ao ajustar.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title="Ajustar saldo manualmente" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {(['REAL', 'DEMO'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAccountType(t)}
            className={cn('h-9 rounded-lg text-xs font-bold transition-colors border',
              accountType === t ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'bg-[#13161f] border-[#1f232e] text-[#8b8f9a]')}
          >
            {t === 'REAL' ? 'Conta Real' : 'Conta Demo'}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-[#8b8f9a] mb-3">
        Saldo atual: <span className="text-white font-semibold">R$ {fmtBRL(acct?.balance ?? '0')}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => setDirection('credit')}
          className={cn('flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-bold transition-colors border',
            direction === 'credit' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'bg-[#13161f] border-[#1f232e] text-[#8b8f9a]')}
        >
          <Plus size={11} /> Creditar
        </button>
        <button
          onClick={() => setDirection('debit')}
          className={cn('flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-bold transition-colors border',
            direction === 'debit' ? 'bg-red-500/15 border-red-500/40 text-red-400' : 'bg-[#13161f] border-[#1f232e] text-[#8b8f9a]')}
        >
          <Minus size={11} /> Debitar
        </button>
      </div>

      <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Valor (R$)</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
        placeholder="0,00"
        inputMode="decimal"
        className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60 mb-3"
      />

      <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">Motivo (obrigatório — registrado em auditoria)</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ex.: reembolso do depósito #1234, correção de operação..."
        rows={2}
        className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/60 resize-none mb-3"
      />

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-[#1f232e] text-xs font-semibold text-[#8b8f9a] hover:text-white">Cancelar</button>
        <button onClick={submit} disabled={!valid || loading} className="flex-1 h-9 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-black transition-colors disabled:opacity-50">
          {loading ? '...' : 'Confirmar'}
        </button>
      </div>
    </Modal>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-[400px] bg-[#13161f] border border-[#1f232e] rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f232e]">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={14} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

function fmtBRL(s: string) {
  return (parseFloat(s) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
