// Fase 4 — boot orchestration. Pulls every layer together: loads
// config, self-heals if empty, bootstraps history, backfills downtime
// gaps, hydrates state from snapshot/tick/candle (Fase 2/3 chain),
// starts the tick loops + periodic flushes.

import type { OtcAssetConfig } from '../types.js'
import { OTC_TIMEFRAMES } from '../types.js'
import { CandleBuilder } from '../engine/candle-builder.js'
import { loadAssetConfigs, selfHealSeed } from '../storage/assets.js'
import { loadLatestCandlePerTimeframe, primeCandleCache } from '../storage/candles.js'
import { loadLatestTicks } from '../storage/ticks.js'
import { loadSnapshots, flushSnapshot } from '../storage/snapshot.js'
import { loadPersistedRuntimeStates, flushRuntimeState } from '../storage/state.js'
import { bootstrapHistoricalCandles } from '../recovery/bootstrap.js'
import { backfillMissingCandles } from '../recovery/backfill.js'
import { sweepAllGaps } from '../recovery/gap-sweep.js'
import { buildInitialState } from '../recovery/initial-state.js'
import {
  assetStates, builders, setBootedAt,
  isEngineRunning, setEngineRunning,
} from './state-map.js'
import {
  startAssetLoop, flushPending, stepAllLiquidity,
  intervals,
} from './loops.js'

const TICK_FLUSH_INTERVAL_MS       = 1_000
const LIQUIDITY_UPDATE_INTERVAL_MS = 10_000
const STATE_FLUSH_INTERVAL_MS      = 5_000
const GAP_SWEEP_INTERVAL_MS        = 30_000
// Prune is temporarily disabled — re-enable after validating the index
// on otc_ticks.recordedAt is in place and the first drain ran cleanly.

// Boots the engine. If it can't load assets on first try (e.g., DB
// not ready, transient connection issue), it backs off and retries up
// to 5 times with growing delays. Previously a single boot failure
// left the worker permanently dead until the next deploy.
export async function startOtcV2Worker(): Promise<void> {
  if (isEngineRunning()) return
  setEngineRunning(true)

  console.log('[otc-v2] booting…')

  let configs: OtcAssetConfig[] = []
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      configs = await loadAssetConfigs()
      if (configs.length > 0) break
      console.warn(`[otc-v2] attempt ${attempt}: otc_assets returned 0 rows`)
      // Inline self-heal on first empty result.
      if (attempt === 1) {
        try {
          await selfHealSeed()
          console.warn('[otc-v2] inline seed attempted — will retry loadAssetConfigs')
        } catch (err) {
          console.error('[otc-v2] inline seed failed:', err)
        }
      }
    } catch (err) {
      console.error(`[otc-v2] attempt ${attempt}: loadAssetConfigs failed`, err)
    }
    await new Promise(r => setTimeout(r, attempt * 2_000))
  }

  if (configs.length === 0) {
    console.error('[otc-v2] BOOT GAVE UP — no assets loaded after 5 attempts. Routes will return ASSET_NOT_FOUND until next restart.')
    setEngineRunning(false)
    return
  }

  try {
    // 1. Bootstrap historical candles (first deploy only — idempotent).
    await bootstrapHistoricalCandles(configs)

    // 2. Hydrate in-memory state from DB (Fase 2/3 chain).
    const latestCandles   = await loadLatestCandlePerTimeframe(configs.map(c => c.id))
    const persistedStates = await loadPersistedRuntimeStates(configs.map(c => c.id))
    const latestTicks     = await loadLatestTicks(configs.map(c => c.id))
    const snapshots       = await loadSnapshots(configs.map(c => c.id))

    for (const cfg of configs) {
      try {
        // Backfill missing slots first so builders pick them up as seed.
        const backfilled = await backfillMissingCandles(cfg)
        if (backfilled > 0) {
          const refreshed = await loadLatestCandlePerTimeframe([cfg.id])
          for (const tf of OTC_TIMEFRAMES) {
            const k = `${cfg.id}:${tf}`
            const c = refreshed.get(k)
            if (c) latestCandles.set(k, c)
          }
        }

        // Fase 2/3 recovery chain: snapshot → tick → candle → seed.
        const result = buildInitialState(
          cfg,
          latestCandles,
          persistedStates.get(cfg.id),
          latestTicks.get(cfg.id) ?? null,
          snapshots.get(cfg.id) ?? null,
        )
        assetStates.set(cfg.id, result.state)

        const cbs: CandleBuilder[] = []
        for (const tf of OTC_TIMEFRAMES) {
          const cb = new CandleBuilder(cfg.id, tf)
          cb.seedFromCandle(latestCandles.get(`${cfg.id}:${tf}`) ?? null)
          cbs.push(cb)
        }
        builders.set(cfg.id, cbs)

        await primeCandleCache(cfg.id)

        // Structured boot log per asset.
        const persisted = persistedStates.get(cfg.id)
        const regimeResumed = persisted?.regime && result.state.regime === persisted.regime
        const rejectStr = result.snapshotRejectReasons.length > 0
          ? ` snapshotRejected=${result.snapshotRejectReasons.join(',')}`
          : ''
        console.log(
          `[otc-boot] asset=${cfg.id}` +
          ` startPrice=${result.state.price.toFixed(5)}` +
          ` source=${result.source}` +
          ` lastTickAt=${result.lastTickAt?.toISOString() ?? '-'}` +
          ` lastCandleAt=${result.lastCandleAt?.toISOString() ?? '-'}` +
          ` backfilled=${backfilled}` +
          ` regime=${result.state.regime}` +
          ` regimeResumed=${regimeResumed ? 'yes' : 'no'}` +
          rejectStr,
        )
      } catch (err) {
        console.error(`[otc-v2] hydrate failed for ${cfg.id} — skipping`, err)
        assetStates.delete(cfg.id)
        builders.delete(cfg.id)
      }
    }

    // 3. Start one tick interval per successfully hydrated asset.
    for (const cfg of configs) {
      if (assetStates.has(cfg.id)) startAssetLoop(cfg.id)
    }

    // 4. Periodic loops.
    setBootedAt(Date.now())
    intervals.flush      = setInterval(flushPending,      TICK_FLUSH_INTERVAL_MS)
    intervals.liquidity  = setInterval(stepAllLiquidity,  LIQUIDITY_UPDATE_INTERVAL_MS)
    intervals.stateFlush = setInterval(async () => {
      await flushRuntimeState()
      await flushSnapshot()
    }, STATE_FLUSH_INTERVAL_MS)
    intervals.gapSweep   = setInterval(() => { void sweepAllGaps() }, GAP_SWEEP_INTERVAL_MS)
    // intervals.prune — DISABLED (see worker.ts comment from earlier
    // hotfix; re-enable in a follow-up after the recordedAt index is
    // confirmed deployed in production).

    console.log(`[otc-v2] running with ${assetStates.size}/${configs.length} assets, ${OTC_TIMEFRAMES.length} timeframes`)
  } catch (err) {
    console.error('[otc-v2] post-config boot failed', err)
    setEngineRunning(false)
  }
}

// Live-add a new asset without restart. Used by /admin/otc PATCH.
export async function reloadOtcV2Assets(): Promise<number> {
  const configs = await loadAssetConfigs()
  for (const cfg of configs) {
    const existing = assetStates.get(cfg.id)
    if (existing) {
      existing.config = cfg
    } else {
      const latestCandles = await loadLatestCandlePerTimeframe([cfg.id])
      const latestTicks   = await loadLatestTicks([cfg.id])
      const result = buildInitialState(
        cfg, latestCandles, undefined, latestTicks.get(cfg.id) ?? null,
      )
      assetStates.set(cfg.id, result.state)
      const cbs = OTC_TIMEFRAMES.map(tf => {
        const cb = new CandleBuilder(cfg.id, tf)
        cb.seedFromCandle(latestCandles.get(`${cfg.id}:${tf}`) ?? null)
        return cb
      })
      builders.set(cfg.id, cbs)
      await primeCandleCache(cfg.id)
      startAssetLoop(cfg.id)
      console.log(`[otc-reload] asset=${cfg.id} startPrice=${result.state.price.toFixed(5)} source=${result.source}`)
    }
  }
  return configs.length
}
