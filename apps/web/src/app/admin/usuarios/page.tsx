'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Users, Search, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ShieldCheck, ShieldAlert, CheckCircle2, XCircle, Clock as ClockIcon,
  SlidersHorizontal, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/lib/useDebounce'
import { UserDetailDrawer } from '@/components/admin/UserDetailDrawer'

interface UserRow {
  id:               string
  name:             string
  email:            string
  role:             'USER' | 'ADMIN'
  kycStatus:        string
  blocked:          boolean
  isFake:           boolean
  twoFactorEnabled: boolean
  createdAt:        string
  realBalance:      string
  demoBalance:      string
  totalOps:         number
  lastActivity:     string | null
}

interface ListResponse {
  users:    UserRow[]
  total:    number
  page:     number
  pageSize: number
}

type RoleFilter    = 'ALL' | 'USER' | 'ADMIN'
type KycFilter     = 'ALL' | 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
type BlockedFilter = 'ALL' | 'YES' | 'NO'

const PAGE_SIZE = 20

export default function AdminUsersPage() {
  const [data, setData]       = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Filters
  const [search, setSearch]   = useState('')
  // 300ms debounce — input stays instant for typing feedback, but the API
  // call only fires after the user stops typing. Cuts query count by ~4x
  // on the typical 4-letter query.
  const debouncedSearch       = useDebounce(search, 300)
  const [role, setRole]       = useState<RoleFilter>('ALL')
  const [kyc, setKyc]         = useState<KycFilter>('ALL')
  const [blocked, setBlocked] = useState<BlockedFilter>('ALL')
  const [page, setPage]       = useState(1)

  // Drawer selection
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page, pageSize: PAGE_SIZE }
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      if (role     !== 'ALL') params.role    = role
      if (kyc      !== 'ALL') params.kyc     = kyc
      if (blocked  !== 'ALL') params.blocked = blocked
      const res = await api.get<ListResponse>('/admin/users', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar usuários.')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, role, kyc, blocked, page])

  // Reset to page 1 whenever filters change.
  useEffect(() => { setPage(1) }, [debouncedSearch, role, kyc, blocked])
  useEffect(() => { load() }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      {/* Topbar */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users size={20} className="text-emerald-400" />
            Usuários
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">
            Gestão de todos os usuários da plataforma
          </p>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#13161f] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* Filters — search bar inline, advanced filters tucked in a popover.
          activeCount badge surfaces when any non-default filter is set so the
          admin sees at a glance that the list is narrowed. */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-3 flex items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, email, CPF ou telefone..."
            className="w-full h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-8 pr-3 text-xs text-white placeholder-[#8b8f9a] outline-none focus:border-emerald-500/50"
          />
        </div>
        <FiltersPopover
          role={role} kyc={kyc} blocked={blocked}
          onRole={setRole} onKyc={setKyc} onBlocked={setBlocked}
        />
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="hidden md:grid grid-cols-[1fr_120px_120px_120px_160px_120px_60px] gap-3 px-4 py-3 border-b border-[#1f232e] text-[10px] font-bold text-[#8b8f9a] uppercase tracking-wide">
          <span>Usuário</span>
          <span>Perfil</span>
          <span>KYC</span>
          <span>Status</span>
          <span className="text-right">Saldo Real</span>
          <span className="text-right">Operações</span>
          <span></span>
        </div>

        {/* Rows */}
        {loading && !data ? (
          <div className="py-12 text-center text-sm text-[#8b8f9a]">Carregando…</div>
        ) : data && data.users.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#8b8f9a]">
            Nenhum usuário encontrado com esses filtros.
          </div>
        ) : (
          data?.users.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedId(u.id)}
              className="w-full text-left grid grid-cols-1 md:grid-cols-[1fr_120px_120px_120px_160px_120px_60px] gap-3 px-4 py-3 border-b border-[#1f232e]/50 hover:bg-white/[0.03] transition-colors items-center"
            >
              {/* User col */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-xs font-bold flex-shrink-0">
                  {initials(u.name || u.email)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white truncate">{u.name || '—'}</span>
                    {u.isFake && (
                      <span className="px-1 py-0 rounded text-[8px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 flex-shrink-0">
                        FAKE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#8b8f9a] truncate">{u.email}</div>
                </div>
              </div>

              <RoleBadge   role={u.role} />
              <KycBadge    status={u.kycStatus} />
              <BlockedBadge blocked={u.blocked} twoFactor={u.twoFactorEnabled} />

              <div className="text-right">
                <div className="text-sm font-bold text-white">R$ {fmtBRL(u.realBalance)}</div>
                <div className="text-[10px] text-[#8b8f9a]">Demo R$ {fmtBRL(u.demoBalance)}</div>
              </div>

              <div className="text-right">
                <div className="text-sm text-white">{u.totalOps}</div>
                <div className="text-[10px] text-[#8b8f9a]">{u.lastActivity ? formatDateShort(u.lastActivity) : '—'}</div>
              </div>

              <div className="flex justify-end">
                <ChevronRight size={14} className="text-[#3a3f50]" />
              </div>
            </button>
          ))
        )}

        {/* Pagination */}
        {data && data.users.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 text-xs text-[#8b8f9a]">
            <span>
              Mostrando {(data.page - 1) * data.pageSize + 1}–
              {Math.min(data.page * data.pageSize, data.total)} de {data.total}
            </span>
            <div className="flex items-center gap-1">
              <Pager disabled={page === 1}          onClick={() => setPage(1)}            ><ChevronsLeft  size={14} /></Pager>
              <Pager disabled={page === 1}          onClick={() => setPage((p) => p - 1)} ><ChevronLeft   size={14} /></Pager>
              <span className="px-2">{page} / {totalPages}</span>
              <Pager disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} ><ChevronRight  size={14} /></Pager>
              <Pager disabled={page === totalPages} onClick={() => setPage(totalPages)}   ><ChevronsRight size={14} /></Pager>
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedId && (
        <UserDetailDrawer
          userId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function FilterPills({
  label, value, options, onChange,
}: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold text-[#8b8f9a] uppercase tracking-wide">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors',
              value === v
                ? 'bg-emerald-500 text-black'
                : 'bg-[#1a1e2a] text-[#8b8f9a] hover:text-white border border-[#1f232e]'
            )}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

// Popover holding all three filter groups behind a single "Filtros" button.
// Anchored to the trigger via relative+absolute (no portal — popover is
// small and lives inside the same overflow container). Closes on outside
// click, Escape, or the X button. activeCount drives the badge on the
// trigger so the admin always sees if filters are narrowing the list.
function FiltersPopover({
  role, kyc, blocked, onRole, onKyc, onBlocked,
}: {
  role:      RoleFilter
  kyc:       KycFilter
  blocked:   BlockedFilter
  onRole:    (v: RoleFilter) => void
  onKyc:     (v: KycFilter) => void
  onBlocked: (v: BlockedFilter) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef         = useRef<HTMLDivElement>(null)

  const activeCount =
    (role    !== 'ALL' ? 1 : 0) +
    (kyc     !== 'ALL' ? 1 : 0) +
    (blocked !== 'ALL' ? 1 : 0)

  // Outside-click + ESC to close. Listener only mounts while the popover is
  // open so we're not paying for it on every page.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown',   onKey)
    }
  }, [open])

  const clearAll = () => {
    onRole('ALL')
    onKyc('ALL')
    onBlocked('ALL')
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-semibold transition-colors',
          open || activeCount > 0
            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
            : 'bg-[#1a1e2a] border-[#1f232e] text-[#8b8f9a] hover:text-white',
        )}
      >
        <SlidersHorizontal size={13} />
        Filtros
        {activeCount > 0 && (
          <span className="ml-1 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-emerald-500 text-black text-[10px] font-bold">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[280px] bg-[#13161f] border border-[#1f232e] rounded-xl shadow-2xl z-30 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-white">Filtros</span>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Fechar"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <FilterPills label="Perfil"  value={role}    options={[['ALL','Todos'],['USER','Usuário'],['ADMIN','Admin']]} onChange={(v) => onRole(v as RoleFilter)} />
            <FilterPills label="KYC"     value={kyc}     options={[['ALL','Todos'],['PENDING','Pendente'],['SUBMITTED','Enviado'],['APPROVED','Aprovado'],['REJECTED','Rejeitado']]} onChange={(v) => onKyc(v as KycFilter)} />
            <FilterPills label="Status"  value={blocked} options={[['ALL','Todos'],['NO','Ativos'],['YES','Bloqueados']]} onChange={(v) => onBlocked(v as BlockedFilter)} />
          </div>

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="mt-4 w-full h-8 rounded-lg border border-[#1f232e] bg-[#1a1e2a] text-[11px] font-semibold text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === 'ADMIN'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold w-fit',
      isAdmin
        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
        : 'bg-[#1a1e2a] text-[#8b8f9a] border border-[#1f232e]'
    )}>
      {isAdmin && <ShieldCheck size={9} />}
      {isAdmin ? 'ADMIN' : 'Usuário'}
    </span>
  )
}

function KycBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
    PENDING:   { label: 'Pendente',  tone: 'bg-[#1a1e2a] text-[#8b8f9a] border-[#1f232e]',         icon: <ClockIcon size={9} /> },
    SUBMITTED: { label: 'Enviado',   tone: 'bg-blue-500/15 text-blue-400 border-blue-500/40',     icon: <ClockIcon size={9} /> },
    APPROVED:  { label: 'Aprovado',  tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40', icon: <CheckCircle2 size={9} /> },
    REJECTED:  { label: 'Rejeitado', tone: 'bg-red-500/15 text-red-400 border-red-500/40',        icon: <XCircle size={9} /> },
  }
  const cfg = map[status] ?? map.PENDING
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold w-fit border', cfg.tone)}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

function BlockedBadge({ blocked, twoFactor }: { blocked: boolean; twoFactor: boolean }) {
  if (blocked) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold w-fit bg-red-500/15 text-red-400 border border-red-500/40">
        <ShieldAlert size={9} /> Bloqueado
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[#8b8f9a]">
      Ativo {twoFactor && <span className="text-emerald-400" title="2FA ativo">· 2FA</span>}
    </span>
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

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0]!.toUpperCase()
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase()
}

function fmtBRL(s: string) {
  return (parseFloat(s) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateShort(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
