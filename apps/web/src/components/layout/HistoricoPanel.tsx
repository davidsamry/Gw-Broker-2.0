'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, ChevronDown, ArrowUp, ArrowDown, Package } from 'lucide-react'
import { ASSETS } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { FlagPair } from '@/components/ui/FlagPair'
import { useOperationsStore, type ApiOperation, type ApiCopyOperation } from '@/store/operations'
import { useAuthStore } from '@/store/auth'

interface HistoricoPanelProps {
  onClose: () => void
}

type Filter = 'FINALIZADAS' | 'PENDENTES' | 'TODAS'

// De onde a linha veio. Antes o painel so' escrevia "CONTA REAL" no topo e
// listava TUDO embaixo — ops da demo apareciam sob o rotulo de real, e as de
// copy nao apareciam de jeito nenhum (moram em outra tabela). Agora cada
// linha diz o que e'.
export type OpKind = 'REAL' | 'DEMO' | 'COPY'

interface Item {
  id:        string
  kind:      OpKind
  ts:        number  // epoch ms — ordena as 3 origens numa lista so'
  date:      string  // "22 Mai"
  time:      string  // "23:36"
  symbol:    string
  code1:     string
  code2:     string
  // Copy nao tem CALL/PUT: o usuario nao escolheu direcao, so' seguiu o
  // trader. Sem direcao, a seta nao aparece.
  direction?: 'CALL' | 'PUT'
  amount:    number
  status:    'OPEN' | 'WON' | 'LOST' | 'CANCELLED' | 'DRAW'
  profit:    number  // R$
  payout:    number  // %
  // Resultado liquido ja' calculado. So' o copy usa: a perda dele pode vir
  // capada no saldo disponivel (pnl -3 numa op de 7), entao derivar
  // "-amount" mostraria um numero que nunca saiu da conta.
  net?:      number
  // Percentual da perda. Ausente = 100%, que e' a regra da opcao binaria:
  // perdeu, perdeu a entrada inteira. So' o copy preenche, pelo mesmo
  // motivo do `net` acima — perda capada nao e' perda de 100%.
  lossPct?:  number
}

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function toItem(op: ApiOperation, kind: OpKind): Item {
  const dt = new Date(op.closedAt ?? op.expiresAt ?? op.openedAt)
  const time = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const date = `${dt.getDate().toString().padStart(2, '0')} ${MONTHS_PT[dt.getMonth()]}`
  // Look up asset in catalog to use the short symbol (e.g. "BTC/USDT") and
  // accurate flag codes — same name shown in the header asset tabs.
  const asset = ASSETS.find((a) => a.id === op.assetId)
  const parts = op.assetId.split('-')
  return {
    id:        op.id,
    kind,
    ts:        dt.getTime(),
    date,
    time,
    symbol:    asset?.symbol ?? op.assetSymbol,
    code1:     asset?.code1 ?? parts[0] ?? '',
    code2:     asset?.code2 ?? parts[1] ?? '',
    direction: op.direction,
    amount:    Number(op.amount),
    status:    op.status,
    profit:    Number(op.profit ?? 0),
    payout:    op.payout,
  }
}

// Op de copy -> Item. Nao tem ativo nem direcao: o "simbolo" e' o nome do
// trader. O percentual sai do pnl real sobre o valor da op, em vez de um
// payout fixo — se a perda veio capada, o numero reflete isso.
function copyToItem(op: ApiCopyOperation): Item {
  const dt   = new Date(op.settledAt)
  const time = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const date = `${dt.getDate().toString().padStart(2, '0')} ${MONTHS_PT[dt.getMonth()]}`
  const amount = Number(op.amount) || 0
  const pnl    = Number(op.pnl)    || 0
  return {
    id:      op.id,
    kind:    'COPY',
    ts:      dt.getTime(),
    date,
    time,
    symbol:  op.traderName,
    code1:   '',
    code2:   '',
    amount,
    status:  op.result === 'WIN' ? 'WON' : 'LOST',
    profit:  pnl,
    payout:  amount > 0 ? Math.round(Math.abs(pnl) / amount * 100) : 0,
    net:     pnl,
    lossPct: amount > 0 ? Math.round(Math.abs(pnl) / amount * 100) : 100,
  }
}

export function HistoricoPanel({ onClose }: HistoricoPanelProps) {
  const [filter, setFilter]       = useState<Filter>('FINALIZADAS')
  const [filterOpen, setFilterOpen] = useState(false)

  // Read from the shared operations cache (hydrated by /auth/me on mount).
  // No more duplicate /operations fetches — the cache is already populated.
  const operations     = useOperationsStore((s) => s.operations)
  const copyOperations = useOperationsStore((s) => s.copyOperations)
  const hydrated       = useOperationsStore((s) => s.hydrated)
  const refetch        = useOperationsStore((s) => s.refetch)
  const loading        = !hydrated

  // accountId -> REAL | DEMO. A op carrega accountId; quem sabe o tipo e' o
  // /auth/me. Sem esse mapa nao da' pra dizer de qual conta a linha veio.
  const accounts = useAuthStore((s) => s.user?.accounts)
  const tipoPorConta = useMemo(() => {
    const m = new Map<string, OpKind>()
    for (const a of accounts ?? []) m.set(a.id, a.type === 'DEMO' ? 'DEMO' : 'REAL')
    return m
  }, [accounts])

  // Refresh every 5s while the panel is open so pending ops update + new
  // resolutions appear without forcing a full page reload.
  useEffect(() => {
    const tick = setInterval(() => { refetch() }, 5000)
    return () => clearInterval(tick)
  }, [refetch])

  // REAL + DEMO + COPY numa lista so', ordenada por horario. Cada uma
  // mantem a etiqueta da origem.
  //
  // Fallback 'REAL' quando o accountId nao esta' no mapa: acontece na
  // janela entre o cache de ops pintar e o /auth/me chegar com as contas.
  // E' o mesmo que a tela mostrava antes, so' que agora por poucos ms.
  const ops = useMemo(() => {
    const normais = operations.map((o) =>
      toItem(o as ApiOperation, tipoPorConta.get((o as ApiOperation).accountId ?? '') ?? 'REAL'),
    )
    const copy = copyOperations.map(copyToItem)
    return [...normais, ...copy].sort((a, b) => b.ts - a.ts)
  }, [operations, copyOperations, tipoPorConta])

  const filtered = ops.filter((o) => {
    if (filter === 'PENDENTES')   return o.status === 'OPEN'
    if (filter === 'FINALIZADAS') return o.status === 'WON' || o.status === 'LOST' || o.status === 'DRAW'
    return true
  })

  return (
    // Width: 380px on desktop (side panel beside chart). Full width + height
    // on mobile, where page.tsx renders this as the sole content of HISTORICO.
    // 2026-06-01: era 280px — apertado pra mostrar "BTC/USDT R\$ 5233,00
    // +R\$ 4448,05 (+85%)" sem espacar/quebrar visual. 380px da conforto.
    <div className="flex flex-col bg-[#1a1e2e] md:border-r border-[#2a2e3b] flex-shrink-0 w-full h-full md:w-[380px]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
        <h2 className="text-base font-bold text-white">Histórico Trading</h2>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Filter dropdown */}
      <div className="px-4 pt-3 pb-2 relative">
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-[#252a3a] border border-[#2a2e3b] hover:border-blue-500/40 transition-colors"
        >
          <span className="text-sm font-medium text-white capitalize">{filter.toLowerCase()}</span>
          <ChevronDown size={14} className={cn('text-[#8b8f9a] transition-transform', filterOpen && 'rotate-180')} />
        </button>
        {filterOpen && (
          <div className="absolute top-full left-4 right-4 mt-1 bg-[#252a3a] border border-[#2a2e3b] rounded-lg overflow-hidden shadow-xl z-20">
            {(['FINALIZADAS', 'PENDENTES', 'TODAS'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setFilterOpen(false) }}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm capitalize transition-colors',
                  f === filter ? 'bg-blue-500/15 text-blue-300' : 'text-white hover:bg-white/5'
                )}
              >
                {f.toLowerCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-6 py-12 text-center text-[#8b8f9a] text-xs">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-[#252a3a] flex items-center justify-center mb-3">
              <Package size={20} className="text-[#8b8f9a]" />
            </div>
            <p className="text-[12px] text-[#8b8f9a]">Nenhuma operação por aqui ainda.</p>
          </div>
        ) : (
          filtered.map((op) => <HistoricoItem key={op.id} item={op} />)
        )}
      </div>
    </div>
  )
}

// Etiqueta da origem, ao lado do nome do ativo. Verde = dinheiro de
// verdade, ambar = conta de pratica, azul = copy trading.
const KINDS: Record<OpKind, { label: string; cls: string; title: string }> = {
  REAL: {
    label: 'REAL',
    cls:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    title: 'Operação na conta real — dinheiro de verdade',
  },
  DEMO: {
    label: 'DEMO',
    cls:   'bg-amber-500/15 text-amber-300 border-amber-500/40',
    title: 'Operação na conta de prática — saldo fictício',
  },
  COPY: {
    label: 'COPY',
    cls:   'bg-blue-500/15 text-blue-300 border-blue-500/40',
    title: 'Copy Trading — operação copiada de um trader, liquidada na conta real',
  },
}

function KindBadge({ kind }: { kind: OpKind }) {
  const k = KINDS[kind]
  return (
    <span
      title={k.title}
      className={cn(
        'flex-shrink-0 px-1.5 py-px rounded border text-[9px] font-black tracking-wide leading-[14px]',
        k.cls,
      )}
    >
      {k.label}
    </span>
  )
}

function HistoricoItem({ item }: { item: Item }) {
  const won  = item.status === 'WON'
  const lost = item.status === 'LOST'
  // DRAW = empate: saída igual à entrada, valor apostado devolvido. Não é
  // ganho nem perda — mostra R$ 0,00 / 0% em cinza, como as pendentes.
  const draw = item.status === 'DRAW'
  // Profit display: won -> +profit, lost -> -amount, draw/pending -> 0.
  // item.net (copy) tem prioridade: la' o valor debitado pode ser menor que
  // o valor da op, e mostrar -amount seria mentira.
  const net = item.net ?? (won ? item.profit : lost ? -item.amount : 0)
  // Percentage: won -> +payout%, lost -> -100%, draw -> 0% (devolvido)
  const pct = won ? `+${item.payout}%` : lost ? `-${item.lossPct ?? 100}%` : '0%'
  const sign = net > 0 ? '+' : net < 0 ? '' : ''
  const netColor = won ? 'text-green-400' : lost ? 'text-red-400' : 'text-[#8b8f9a]'

  // FlagPair handles dual-flag pairs (us/eu), crypto pairs (crypto:btc/us),
  // and single-icon assets like 'asset:gold' / 'stock:aapl' (where code2 is
  // empty by design). Only require code1 — FlagPair routes internally based
  // on its prefix. Fallback below only fires for assets missing from the
  // catalog entirely (orphan / deleted IDs).
  const hasFlags = Boolean(item.code1)

  return (
    <div className="px-3 mb-px">
      <div className="px-2 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
        <div className="flex items-center gap-2">
          {/* Date + time */}
          <div className="flex flex-col items-start min-w-[42px]">
            <span className="text-[12px] font-bold text-white leading-tight">{item.time}</span>
            <span className="text-[10px] text-[#8b8f9a] leading-tight">{item.date}</span>
          </div>

          {/* Asset icon — copy nao tem ativo, entao usa a inicial do trader
              num circulo azul (mesma cor da etiqueta COPY). */}
          <div className="flex-shrink-0">
            {item.kind === 'COPY' ? (
              <div className="w-[26px] h-[26px] rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[11px] font-black">
                {item.symbol[0]?.toUpperCase() ?? 'C'}
              </div>
            ) : hasFlags ? (
              <FlagPair code1={item.code1} code2={item.code2} size={18} />
            ) : (
              <div className="w-[26px] h-[26px] rounded-full bg-gradient-to-br from-[#f7931a] to-[#ffb84d] flex items-center justify-center text-white text-[11px] font-black">
                {item.symbol[0]}
              </div>
            )}
          </div>

          {/* Symbol + etiqueta da origem */}
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="text-[12px] font-semibold text-white truncate">
              {item.symbol}
            </span>
            <KindBadge kind={item.kind} />
          </div>

          {/* Right block: direction + profit */}
          <div className="flex flex-col items-end flex-shrink-0">
            <div className="flex items-center gap-1">
              {item.direction === 'CALL' && <ArrowUp   size={10} strokeWidth={3} className="text-green-400" />}
              {item.direction === 'PUT'  && <ArrowDown size={10} strokeWidth={3} className="text-red-400" />}
              <span className="text-[11px] font-bold text-white">R$ {item.amount.toFixed(2).replace('.', ',')}</span>
            </div>
            <span className={cn('text-[10px] font-bold mt-0.5', netColor)}>
              {draw
                ? 'Empate — devolvido'
                : `${sign}R$ ${Math.abs(net).toFixed(2).replace('.', ',')} (${pct})`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
