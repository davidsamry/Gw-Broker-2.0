'use client'

import { useEffect, useState } from 'react'
import {
  DollarSign, ArrowDownToLine, Receipt, Activity as ActivityIcon,
  Wallet, Gift, Layers, Users as UsersIcon,
  Target, TrendingUp, TrendingDown, ArrowUpRight,
  RefreshCw,
} from 'lucide-react'
import { KpiCard } from '@/components/admin/KpiCard'
import { PeriodFilter, rangeFromPreset, type PeriodPreset } from '@/components/admin/PeriodFilter'
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
  // Default to "Hoje" — admin wants to see today's activity first.
  // Users can switch to 7d/30d/custom from the PeriodFilter chips.
  const [preset, setPreset]   = useState<PeriodPreset>('hoje')
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
    } catch (err: any) {
      // Surface the backend detail so column-missing errors (migration
      // not applied yet) are diagnosable instead of a generic message.
      const detail = err?.response?.data?.detail
      if (detail && /column .* does not exist/i.test(detail)) {
        setError('Migration pendente no banco. Rode o SQL no Supabase ou reimplante a API.')
      } else if (detail) {
        setError(`Erro: ${detail}`)
      } else {
        setError('Erro ao carregar o dashboard.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(preset === 'custom' ? '30d' : preset) }, [preset])

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 max-w-[1400px] mx-auto">
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
          icon={<UsersIcon size={14} />} tone="bg-emerald-500/15 text-emerald-400"
        />

        <KpiCard label="Valor Apostado"       value={`R$ ${fmtBRL(data?.kpis.totalWagered      ?? 0)}`} icon={<Target           size={14} />} tone="bg-orange-500/15 text-orange-400" />
        <KpiCard label="Ganhos Plataforma"    value={`R$ ${fmtBRL(data?.kpis.platformProfit    ?? 0)}`} hint="(Perdas dos usuários)" icon={<TrendingUp size={14} />} tone="bg-emerald-500/15 text-emerald-400" valueTone="text-emerald-400" />
        <KpiCard label="Perdas Plataforma"    value={`R$ ${fmtBRL(data?.kpis.platformLoss      ?? 0)}`} hint="(Ganhos dos usuários)" icon={<TrendingDown size={14} />} tone="bg-red-500/15 text-red-400" valueTone="text-red-400" />
        <KpiCard label="Resultado Plataforma" value={`R$ ${fmtBRL(data?.kpis.platformNetResult ?? 0)}`} hint="Ganhos - Perdas" icon={<ArrowUpRight size={14} />} tone="bg-emerald-500/15 text-emerald-400" valueTone={data && data.kpis.platformNetResult >= 0 ? 'text-emerald-400' : 'text-red-400'} />
      </div>

      {/* 2026-06-01: charts intermediarios todos removidos por pedido do
          admin (Distribuicao, Qtd Operacoes, Desempenho 7 Dias, Resumo
          Financeiro). Dados ja' cobertos pelos KPIs no topo. Sobra a
          tabela de Usuarios Lucrativos abaixo. */}

      {/* Lucrative users table */}
      <LucrativeUsersTable
        rows={data?.lucrativeUsers ?? []}
        total={data?.lucrativeCount ?? 0}
      />
    </div>
  )
}
