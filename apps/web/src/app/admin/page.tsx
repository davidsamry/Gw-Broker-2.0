'use client'

import { useEffect, useState } from 'react'
import {
  DollarSign, ArrowDownToLine, Receipt, Activity as ActivityIcon,
  Wallet, Gift, Layers, Users as UsersIcon,
  Target, TrendingUp, TrendingDown, ArrowUpRight,
  BarChart3, RefreshCw,
} from 'lucide-react'
import { KpiCard } from '@/components/admin/KpiCard'
import { PeriodFilter, rangeFromPreset, type PeriodPreset } from '@/components/admin/PeriodFilter'
import { DonutChart } from '@/components/admin/charts/DonutChart'
import { AreaChart } from '@/components/admin/charts/AreaChart'
import { BarHorizontal } from '@/components/admin/charts/BarHorizontal'
import { LucrativeUsersTable, type LucrativeUserRow } from '@/components/admin/LucrativeUsersTable'
import { api } from '@/lib/api'

interface DashboardData {
  range: { from: string; to: string }
  kpis: {
    totalDeposits:        number
    totalWithdrawals:     number
    avgTicket:            number
    netFlow:              number
    userBalance:          number
    userBonus:            number
    userBalancePlusBonus: number
    totalUsers:           number
    newUsersToday:        number
    totalWagered:         number
    platformProfit:       number
    platformLoss:         number
    platformNetResult:    number
  }
  charts: {
    distribution:    { wins: number; losses: number }
    last7days:       Array<{ date: string; wins: number; losses: number }>
    operationCounts: { userWins: number; userLosses: number }
  }
  lucrativeUsers: LucrativeUserRow[]
  lucrativeCount: number
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function AdminDashboardPage() {
  const [preset, setPreset]   = useState<PeriodPreset>('30d')
  const [data, setData]       = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function load(p: Exclude<PeriodPreset, 'custom'>) {
    setLoading(true)
    setError('')
    try {
      const range  = rangeFromPreset(p)
      const params = { from: range.from.toISOString(), to: range.to.toISOString() }
      const res    = await api.get<DashboardData>('/admin/dashboard', { params })
      setData(res.data)
    } catch {
      setError('Erro ao carregar o dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(preset === 'custom' ? '30d' : preset) }, [preset])

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">
      {/* Topbar */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">Visão geral da plataforma</p>
        </div>
        <button
          onClick={() => load(preset === 'custom' ? '30d' : preset)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#13161f] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* Period filter */}
      <div className="mb-5">
        <PeriodFilter active={preset} onChange={(p) => setPreset(p)} />
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* KPI grid — 4 cards × 3 rows */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Total Depósitos"     value={`R$ ${fmtBRL(data?.kpis.totalDeposits        ?? 0)}`} icon={<DollarSign       size={14} />} tone="bg-emerald-500/15 text-emerald-400" />
        <KpiCard label="Total Saques"        value={`R$ ${fmtBRL(data?.kpis.totalWithdrawals     ?? 0)}`} icon={<ArrowDownToLine  size={14} />} tone="bg-red-500/15 text-red-400" />
        <KpiCard label="Ticket Médio"        value={`R$ ${fmtBRL(data?.kpis.avgTicket            ?? 0)}`} icon={<Receipt          size={14} />} tone="bg-blue-500/15 text-blue-400" />
        <KpiCard label="Fluxo Líquido"       value={`R$ ${fmtBRL(data?.kpis.netFlow              ?? 0)}`} icon={<ActivityIcon     size={14} />} tone="bg-purple-500/15 text-purple-400" valueTone="text-emerald-400" />

        <KpiCard label="Saldo Total Usuários" value={`R$ ${fmtBRL(data?.kpis.userBalance          ?? 0)}`} icon={<Wallet           size={14} />} tone="bg-emerald-500/15 text-emerald-400" />
        <KpiCard label="Bônus Total Usuários" value={`R$ ${fmtBRL(data?.kpis.userBonus            ?? 0)}`} icon={<Gift             size={14} />} tone="bg-orange-500/15 text-orange-400" />
        <KpiCard label="Saldo + Bônus"        value={`R$ ${fmtBRL(data?.kpis.userBalancePlusBonus ?? 0)}`} icon={<Layers           size={14} />} tone="bg-purple-500/15 text-purple-400" />
        <KpiCard label="Total Usuários"
          value={String(data?.kpis.totalUsers ?? 0)}
          hint={data && data.kpis.newUsersToday > 0 ? `+${data.kpis.newUsersToday} hoje` : undefined}
          icon={<UsersIcon size={14} />} tone="bg-emerald-500/15 text-emerald-400"
        />

        <KpiCard label="Valor Apostado"       value={`R$ ${fmtBRL(data?.kpis.totalWagered      ?? 0)}`} icon={<Target           size={14} />} tone="bg-orange-500/15 text-orange-400" />
        <KpiCard label="Ganhos Plataforma"    value={`R$ ${fmtBRL(data?.kpis.platformProfit    ?? 0)}`} hint="(Perdas dos usuários)" icon={<TrendingUp size={14} />} tone="bg-emerald-500/15 text-emerald-400" valueTone="text-emerald-400" />
        <KpiCard label="Perdas Plataforma"    value={`R$ ${fmtBRL(data?.kpis.platformLoss      ?? 0)}`} hint="(Ganhos dos usuários)" icon={<TrendingDown size={14} />} tone="bg-red-500/15 text-red-400" valueTone="text-red-400" />
        <KpiCard label="Resultado Plataforma" value={`R$ ${fmtBRL(data?.kpis.platformNetResult ?? 0)}`} hint="Ganhos - Perdas" icon={<ArrowUpRight size={14} />} tone="bg-emerald-500/15 text-emerald-400" valueTone={data && data.kpis.platformNetResult >= 0 ? 'text-emerald-400' : 'text-red-400'} />
      </div>

      {/* Charts row: donut + area */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-3 mb-5">
        <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={14} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Distribuição de Resultados</h3>
          </div>
          <DonutChart wins={data?.charts.distribution.wins ?? 0} losses={data?.charts.distribution.losses ?? 0} />
        </div>
        <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Desempenho dos Últimos 7 Dias</h3>
          </div>
          <AreaChart data={data?.charts.last7days ?? []} />
        </div>
      </div>

      {/* Operations counts + Financial summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
        <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={14} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Quantidade de Operações</h3>
          </div>
          <BarHorizontal
            userWins={data?.charts.operationCounts.userWins   ?? 0}
            userLosses={data?.charts.operationCounts.userLosses ?? 0}
          />
        </div>
        <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Wallet size={14} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Resumo Financeiro</h3>
          </div>
          <div className="flex flex-col gap-2.5">
            <FinancialRow label="Entradas (Depósitos)" value={`R$ ${fmtBRL(data?.kpis.totalDeposits        ?? 0)}`} tone="text-emerald-400" />
            <FinancialRow label="Saídas (Saques)"      value={`R$ ${fmtBRL(data?.kpis.totalWithdrawals     ?? 0)}`} tone="text-red-400" />
            <FinancialRow label="Saldo em Contas"      value={`R$ ${fmtBRL(data?.kpis.userBalancePlusBonus ?? 0)}`} tone="text-blue-400" />
            <FinancialRow label="Lucro da Plataforma"  value={`R$ ${fmtBRL(data?.kpis.platformNetResult    ?? 0)}`} tone={data && data.kpis.platformNetResult >= 0 ? 'text-emerald-400' : 'text-red-400'} />
          </div>
        </div>
      </div>

      {/* Lucrative users table */}
      <LucrativeUsersTable
        rows={data?.lucrativeUsers ?? []}
        total={data?.lucrativeCount ?? 0}
      />
    </div>
  )
}

function FinancialRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-[#0f1117] border border-[#1f232e]">
      <span className="text-xs text-[#8b8f9a]">{label}</span>
      <span className={`text-sm font-bold ${tone}`}>{value}</span>
    </div>
  )
}
