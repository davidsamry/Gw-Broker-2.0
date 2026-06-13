'use client'

// Copy Trading — painel do usuário (sidebar no desktop, full-screen no
// mobile). Abas: "Traders" (catálogo) e "Meus Traders" (assinaturas ativas).
//
// Lógica financeira é toda no backend (/copy/*). Aqui: lista, decide o modal
// pelo erro retornado (NO_BALANCE / INSUFFICIENT_BALANCE) e dispara o
// depósito via onDeposit. As operações copiadas são liquidadas no tempo pelo
// copyWorker (1ª em 1min, demais a cada 30min) e MEXEM no saldo REAL — por
// isso há um poll leve enquanto houver op pendente, pra refletir saldo e
// histórico sem o usuário recarregar. NÃO contam rollover/ranking.

import { useEffect, useState, useCallback, useRef } from 'react'
import { X, Search, Users, Loader2, Crown, ArrowRight, CheckCircle2, Wallet, ArrowUp, ArrowDown } from 'lucide-react'
import {
  fetchCopyTraders, fetchMyCopyTraders, copyTrader, cancelCopyTrader,
  type CopyTrader, type MyCopyTrader,
} from '@/lib/copyApi'
import { cn } from '@/lib/utils'

interface CopyPanelProps {
  onClose:    () => void
  onDeposit?: () => void   // abre o modal de depósito
  onCopied?:  () => void   // pai dá refresh no saldo após compra
}

type Tab = 'TRADERS' | 'MEUS'
type ModalKind = null | 'NO_BALANCE' | 'INSUFFICIENT' | 'COPIED'

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function FlagAvatar({ trader, size = 34 }: { trader: { avatarUrl: string | null; countryCode: string; name: string }; size?: number }) {
  const src = trader.avatarUrl || `https://flagcdn.com/w80/${trader.countryCode}.png`
  return (
    <img
      src={src}
      alt={trader.name}
      width={size}
      height={size}
      className="rounded-full object-cover border-2 border-[#1a1e2e] flex-shrink-0 bg-[#252a3a]"
      style={{ width: size, height: size }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).src = `https://flagcdn.com/w80/${trader.countryCode}.png` }}
    />
  )
}

export function CopyPanel({ onClose, onDeposit, onCopied }: CopyPanelProps) {
  const [tab, setTab]         = useState<Tab>('TRADERS')
  const [traders, setTraders] = useState<CopyTrader[]>([])
  const [mine, setMine]       = useState<MyCopyTrader[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [modal, setModal]     = useState<ModalKind>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, m] = await Promise.all([fetchCopyTraders(), fetchMyCopyTraders()])
      setTraders(t.traders)
      setMine(m)
    } catch { /* mantém estado anterior */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  // Poll leve enquanto houver op pendente: o copyWorker liquida em background
  // (mexe no saldo REAL), então sem isto o saldo do header e o histórico
  // ficariam parados até um reload. Refaz só "Meus Traders" + saldo (sem o
  // spinner). Para sozinho quando todas liquidam (nextOpAt some). onCopied via
  // ref pra não recriar o intervalo a cada render.
  const onCopiedRef = useRef(onCopied)
  onCopiedRef.current = onCopied
  const hasPending = mine.some((m) => m.nextOpAt)
  useEffect(() => {
    if (!hasPending) return
    const id = setInterval(() => {
      void (async () => {
        try {
          setMine(await fetchMyCopyTraders())
          onCopiedRef.current?.()   // refresh do saldo no header
        } catch { /* noop */ }
      })()
    }, 30_000)
    return () => clearInterval(id)
  }, [hasPending])

  async function handleCopy(t: CopyTrader) {
    if (busyId || t.copied) return
    setBusyId(t.id)
    try {
      await copyTrader(t.id)
      setModal('COPIED')
      onCopied?.()          // refresh saldo (pago debitou)
      await load()          // atualiza listas + flag copied
    } catch (err: any) {
      const code = err?.response?.data?.error
      if (code === 'NO_BALANCE')           setModal('NO_BALANCE')
      else if (code === 'INSUFFICIENT_BALANCE') setModal('INSUFFICIENT')
      else if (code === 'ALREADY_COPYING') await load()
      // outros erros: silencioso (raro)
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancel(traderId: string) {
    if (busyId) return
    setBusyId(traderId)
    try {
      await cancelCopyTrader(traderId)
      await load()
    } catch { /* noop */ }
    finally { setBusyId(null) }
  }

  const filtered = traders.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col h-full bg-[#0e1019] text-white w-full md:w-[420px] md:border-l md:border-[#1e2235]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2235]">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-[#3080ff]" />
          <span className="text-sm font-bold">Copy Trading</span>
        </div>
        <button onClick={onClose} className="text-[#8b8f9a] hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1e2235] px-2">
        {([['TRADERS', 'Traders'], ['MEUS', 'Meus Traders']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'flex-1 py-2.5 text-xs font-bold transition-colors border-b-2 -mb-px',
              tab === k ? 'text-white border-[#3080ff]' : 'text-[#8b8f9a] border-transparent hover:text-white',
            )}
          >
            {label}{k === 'MEUS' && mine.length > 0 ? ` (${mine.length})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-[#3080ff]" />
        </div>
      ) : tab === 'TRADERS' ? (
        <>
          {/* Subtítulo + busca */}
          <div className="px-4 pt-3 pb-2">
            <p className="text-[11px] text-[#8b8f9a] leading-snug mb-2">
              Copie os melhores traders para aprender e crescer. Forma fácil pra quem está começando.
            </p>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8f9a]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#171b27] border border-[#2a2e3b] text-xs text-white placeholder:text-[#8b8f9a] focus:outline-none focus:border-[#3080ff]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2.5">
            {filtered.length === 0 ? (
              <div className="text-center text-xs text-[#8b8f9a] py-10">Nenhum trader encontrado</div>
            ) : filtered.map((t) => (
              <TraderCard
                key={t.id}
                trader={t}
                busy={busyId === t.id}
                onCopy={() => handleCopy(t)}
              />
            ))}
          </div>
        </>
      ) : (
        /* ── Meus Traders ── */
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
          {mine.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center text-[#8b8f9a] py-16 gap-2">
              <Users size={28} className="opacity-40" />
              <p className="text-xs">Você ainda não copia nenhum trader.</p>
              <button onClick={() => setTab('TRADERS')} className="text-[#3080ff] text-xs font-semibold hover:underline">
                Ver traders disponíveis
              </button>
            </div>
          ) : mine.map((m) => (
            <MyTraderCard
              key={m.subscriptionId}
              t={m}
              busy={busyId === m.traderId}
              onCancel={() => handleCancel(m.traderId)}
            />
          ))}
        </div>
      )}

      {/* ── Modais ── */}
      {modal === 'NO_BALANCE' && (
        <CopyModal
          icon={<Wallet size={26} className="text-[#3080ff]" />}
          title="Tudo pronto para copiar este trader"
          message="Para começar, realize um depósito em sua conta."
          cta="Realizar Depósito"
          onCta={() => { setModal(null); onDeposit?.() }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'INSUFFICIENT' && (
        <CopyModal
          icon={<Wallet size={26} className="text-amber-400" />}
          title="Saldo insuficiente"
          message="Saldo insuficiente para adquirir este Copy Trader."
          cta="Depositar Agora"
          onCta={() => { setModal(null); onDeposit?.() }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'COPIED' && (
        <CopyModal
          icon={<CheckCircle2 size={26} className="text-emerald-400" />}
          title="Trader copiado!"
          message="Acesso liberado. Acompanhe em 'Meus Traders'."
          cta="Ver Meus Traders"
          onCta={() => { setModal(null); setTab('MEUS') }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── Card do trader (catálogo) ───────────────────────────────────────────────
function TraderCard({ trader: t, busy, onCopy }: { trader: CopyTrader; busy: boolean; onCopy: () => void }) {
  const gainColor = t.weeklyGainPct >= 0 ? 'text-[#3080ff]' : 'text-red-400'
  return (
    <div className="rounded-xl bg-[#171b27] border border-[#252a3a] p-3">
      {/* Linha topo: avatar + nome + VIP */}
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <FlagAvatar trader={t} />
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#171b27]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white truncate">{t.name}</span>
            {t.vip && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold text-white px-1.5 py-px rounded-full" style={{ background: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}>
                <Crown size={8} /> VIP
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#8b8f9a] mt-0.5">
            <Users size={10} /> Copiadores: <b className="text-white">{t.copiers.toLocaleString('pt-BR')}</b>
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div>
          <div className="text-[9px] text-[#8b8f9a] uppercase tracking-wide">Ganho/sem</div>
          <div className={cn('text-base font-extrabold', gainColor)}>{t.weeklyGainPct >= 0 ? '' : ''}{t.weeklyGainPct.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[9px] text-[#8b8f9a] uppercase tracking-wide">Negociações</div>
          <div className="text-base font-extrabold text-white">{t.copiedTrades.toLocaleString('pt-BR')}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#8b8f9a] uppercase tracking-wide">Comissão</div>
          <div className="text-base font-extrabold text-white">{t.commissionPct}%</div>
        </div>
      </div>

      {/* Barra lucro/perda */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[9px] mb-1">
          <span className="text-emerald-400 font-semibold">{t.profitPct}% Lucro</span>
          <span className="text-red-400 font-semibold">Perda {t.lossPct}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden bg-red-500/40 flex">
          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, t.profitPct))}%` }} />
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={onCopy}
        disabled={busy || t.copied}
        className={cn(
          'mt-3 w-full py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5',
          t.copied
            ? 'bg-emerald-500/15 text-emerald-400 cursor-default'
            : 'text-white hover:brightness-110',
        )}
        style={t.copied ? undefined : { background: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" />
          : t.copied ? <><CheckCircle2 size={14} /> Copiando</>
          : t.paid ? <>Adquirir · R$ {brl(t.accessPrice)}</>
          : <>Copiar grátis <ArrowRight size={14} /></>}
      </button>
    </div>
  )
}

// ── Card de "Meus Traders" ──────────────────────────────────────────────────
function MyTraderCard({ t, busy, onCancel }: { t: MyCopyTrader; busy: boolean; onCancel: () => void }) {
  const accColor = t.accumulated >= 0 ? 'text-emerald-400' : 'text-red-400'
  const date = new Date(t.activatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  return (
    <div className="rounded-xl bg-[#171b27] border border-[#252a3a] p-3">
      <div className="flex items-center gap-2.5">
        <FlagAvatar trader={t} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white truncate">{t.name}</span>
            {t.vip && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold text-white px-1.5 py-px rounded-full" style={{ background: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}>
                <Crown size={8} /> VIP
              </span>
            )}
          </div>
          <div className="text-[10px] text-[#8b8f9a] mt-0.5">
            Ativo desde {date} · {t.paid ? `Pago R$ ${brl(t.pricePaid)}` : 'Gratuito'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-center">
        <div className="rounded-lg bg-[#0e1019]/60 py-1.5">
          <div className="text-[9px] text-[#8b8f9a] uppercase">Operações</div>
          <div className="text-sm font-extrabold text-white">{t.opsGenerated}</div>
        </div>
        <div className="rounded-lg bg-[#0e1019]/60 py-1.5">
          <div className="text-[9px] text-[#8b8f9a] uppercase">Resultado</div>
          <div className={cn('text-sm font-extrabold', accColor)}>
            {t.accumulated >= 0 ? '+' : '-'}R$ {brl(Math.abs(t.accumulated))}
          </div>
        </div>
      </div>

      {/* Histórico das operações copiadas (só as que já apareceram/liquidaram) */}
      {t.operations.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] text-[#8b8f9a] uppercase tracking-wide mb-1.5">Histórico de operações</div>
          <div className="rounded-lg bg-[#0e1019]/60 divide-y divide-[#1e2235] max-h-44 overflow-y-auto">
            {t.operations.map((op) => {
              const win = op.result === 'WIN'
              const time = new Date(op.settledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              return (
                <div key={op.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className={cn(
                    'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                    win ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400',
                  )}>
                    {win ? <ArrowUp size={9} strokeWidth={3} /> : <ArrowDown size={9} strokeWidth={3} />}
                  </span>
                  <span className="text-[11px] text-white flex-1">{win ? 'Ganho' : 'Perda'}</span>
                  <span className="text-[10px] font-mono text-[#8b8f9a]">{time}</span>
                  <span className={cn('text-[11px] font-bold w-20 text-right', win ? 'text-emerald-400' : 'text-red-400')}>
                    {win ? '+' : '-'}R$ {brl(Math.abs(op.pnl))}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Status fixo — conta conectada ao trader */}
      <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-[#8b8f9a]">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Sua conta está conectada ao trader.
      </div>

      <button
        onClick={onCancel}
        disabled={busy}
        className="mt-3 w-full py-2 rounded-lg text-xs font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition flex items-center justify-center gap-1.5"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Cancelar Cópia'}
      </button>
    </div>
  )
}

// ── Modal genérico ──────────────────────────────────────────────────────────
function CopyModal({ icon, title, message, cta, onCta, onClose }: {
  icon: React.ReactNode; title: string; message: string; cta: string; onCta: () => void; onClose: () => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-5 animate-fadeIn" onClick={onClose}>
      <div className="w-full max-w-[300px] rounded-2xl bg-[#171b27] border border-[#2a2e3b] p-5 text-center animate-scaleIn" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto w-12 h-12 rounded-full bg-[#0e1019] flex items-center justify-center mb-3">{icon}</div>
        <h3 className="text-sm font-bold text-white">{title}</h3>
        <p className="text-xs text-[#8b8f9a] mt-1.5 leading-relaxed">{message}</p>
        <button
          onClick={onCta}
          className="mt-4 w-full py-2.5 rounded-lg text-xs font-bold text-white transition hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}
        >
          {cta}
        </button>
        <button onClick={onClose} className="mt-2 w-full py-1.5 text-[11px] text-[#8b8f9a] hover:text-white transition">
          Agora não
        </button>
      </div>
    </div>
  )
}
