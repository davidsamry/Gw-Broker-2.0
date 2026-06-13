import { api } from './api'

// Espelha apps/api/src/copy/service.ts (CopyTraderRow / MyTraderRow).
export interface CopyTrader {
  id:            string
  name:          string
  countryCode:   string
  avatarUrl:     string | null
  vip:           boolean
  paid:          boolean
  accessPrice:   number
  weeklyGainPct: number
  copiers:       number
  copiedTrades:  number
  commissionPct: number
  profitPct:     number
  lossPct:       number
  active:        boolean
  copied:        boolean
}

export interface CopyOp {
  id:        string
  result:    'WIN' | 'LOSS'
  amount:    number
  pnl:       number
  settledAt: string   // quando a op apareceu/liquidou
}

export interface MyCopyTrader {
  subscriptionId: string
  traderId:       string
  name:           string
  countryCode:    string
  avatarUrl:      string | null
  vip:            boolean
  paid:           boolean
  activatedAt:    string
  pricePaid:      number
  opsGenerated:   number          // ops já liquidadas
  accumulated:    number          // soma do pnl das liquidadas
  nextOpAt:       string | null   // quando cai a próxima op (ou null)
  operations:     CopyOp[]        // histórico das liquidadas
}

export async function fetchCopyTraders(): Promise<{ traders: CopyTrader[]; enabled: boolean }> {
  const { data } = await api.get<{ traders: CopyTrader[]; enabled: boolean }>('/copy/traders')
  return data
}

export async function fetchMyCopyTraders(): Promise<MyCopyTrader[]> {
  const { data } = await api.get<{ traders: MyCopyTrader[] }>('/copy/my')
  return data.traders
}

export interface CopyResult {
  subscriptionId: string
  paid:           boolean
  pricePaid:      number
  opsGenerated:   number
}

// POST copiar. Lança o erro do axios (com response.data.error) pro caller
// decidir qual modal abrir (NO_BALANCE / INSUFFICIENT_BALANCE / etc).
export async function copyTrader(traderId: string): Promise<CopyResult> {
  const { data } = await api.post<{ result: CopyResult }>(`/copy/${traderId}/copy`)
  return data.result
}

export async function cancelCopyTrader(traderId: string): Promise<void> {
  await api.post(`/copy/${traderId}/cancel`)
}
