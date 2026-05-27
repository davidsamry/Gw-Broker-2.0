// Forex module boot lifecycle.
//
// F1 stage: loads asset configs from `forex_assets`, attempts to instantiate
// the cTrader client from env vars (returns null + warns when creds are
// missing). The provider's `start()` is wired through but currently a no-op
// at this stage. All the live-stream / candle aggregation / WS server logic
// arrives in F2-F4 — boot is intentionally minimal so we can ship the
// scaffolding without behavioural risk.

import { prisma } from '../../prisma.js'
import type { ForexAssetConfig } from '../types.js'
import { tryCreateCTraderClient } from '../providers/ctrader/client.js'
import type { MarketProvider, ProviderStatus } from '../providers/types.js'
import { aggregateTick, flushInFlightBars } from './aggregator.js'

interface RuntimeState {
  provider: MarketProvider | null
  status:   ProviderStatus
  assets:   ForexAssetConfig[]
  bootedAt: number
}

const state: RuntimeState = {
  provider: null,
  status:   'INITIAL',
  assets:   [],
  bootedAt: 0,
}

export function getForexRuntimeState(): RuntimeState {
  return state
}

async function loadAssetConfigs(): Promise<ForexAssetConfig[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; symbol: string; name: string;
    digits: number; pipSize: string;
    enabled: boolean; ctraderSymbolId: number | null;
    displayOrder: number;
  }>>`
    SELECT id, symbol, name, digits,
           "pipSize"::text AS "pipSize",
           enabled, "ctraderSymbolId", "displayOrder"
    FROM forex_assets
    WHERE enabled = TRUE
    ORDER BY "displayOrder" ASC, symbol ASC
  `
  return rows.map(r => ({
    id:              r.id,
    symbol:          r.symbol,
    name:            r.name,
    digits:          r.digits,
    pipSize:         Number(r.pipSize),
    enabled:         r.enabled,
    ctraderSymbolId: r.ctraderSymbolId,
    displayOrder:    r.displayOrder,
  }))
}

export async function startForexRuntime(): Promise<void> {
  console.log('[forex] runtime booting…')
  state.bootedAt = Date.now()

  try {
    state.assets = await loadAssetConfigs()
    console.log(`[forex] loaded ${state.assets.length} asset configs:`, state.assets.map(a => a.symbol).join(', '))
  } catch (err) {
    console.error('[forex] failed to load asset configs — runtime will run with empty asset list', err)
    state.assets = []
  }

  // F1: provider is optional. Without creds we boot in no-op mode so the
  // status page + REST endpoints + (eventually) WS server still work and
  // an operator can drop credentials in later without redeploy.
  state.provider = tryCreateCTraderClient()
  if (!state.provider) {
    console.warn('[forex] no cTrader credentials — booting WITHOUT live provider (set CTRADER_* env vars to enable)')
    state.status = 'INITIAL'
    return
  }

  try {
    await state.provider.start(state.assets, {
      onTick:   (tick) => aggregateTick(tick),
      onStatus: (status, detail) => {
        state.status = status
        console.log(`[forex/ctrader] status=${status}${detail ? ` (${detail})` : ''}`)
      },
      onError:  (err) => {
        console.error('[forex/ctrader] provider error:', err)
      },
    })
  } catch (err) {
    console.error('[forex/ctrader] provider start FAILED — continuing without it', err)
    state.status = 'STOPPED'
  }

  // Periodic flush of in-progress bars. Without this, a restart loses
  // whatever OHLC was built in the current slot. Every 5s gives the next
  // boot a near-current state to resume from (worst case a 5s gap).
  if (!flushInterval) {
    flushInterval = setInterval(() => {
      void flushInFlightBars()
    }, 5_000)
  }
}

let flushInterval: ReturnType<typeof setInterval> | null = null

export async function stopForexRuntime(): Promise<void> {
  if (flushInterval) { clearInterval(flushInterval); flushInterval = null }
  // One last flush so whatever's mid-aggregation survives the shutdown.
  try { await flushInFlightBars() }
  catch (err) { console.error('[forex] final flush error', err) }
  if (state.provider) {
    try { await state.provider.stop() }
    catch (err) { console.error('[forex/ctrader] stop error', err) }
  }
  state.status = 'STOPPED'
}
