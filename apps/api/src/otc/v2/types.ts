// Shared types for the OTC v2 pricing engine. Kept in one place so the
// individual modules (engine / candle builder / worker) don't import each
// other circularly.

export type OtcRegime =
  | 'LATERAL'
  | 'TREND_UP_WEAK'
  | 'TREND_UP_STRONG'
  | 'TREND_DOWN_WEAK'
  | 'TREND_DOWN_STRONG'
  | 'HIGH_VOL'
  | 'LOW_VOL'
  | 'COMPRESSION'
  | 'EXPANSION'

// Asset config loaded once on engine boot. Mutable copy lives in the
// worker (admin can patch volatility/speed live).
export interface OtcAssetConfig {
  id:               string
  seedPrice:        number
  volatilityBase:   number    // tick size as fraction of seedPrice
  speedMultiplier:  number    // 1 = base tick rate
  enabled:          boolean
  paused:           boolean
}

// Per-asset live state held in memory. Mutated 10×/sec by the engine.
export interface OtcAssetState {
  config:          OtcAssetConfig
  // Pricing
  price:           number    // raw price after last step
  smoothedPrice:   number    // EMA-smoothed (this is what we emit)
  // Regime FSM
  regime:          OtcRegime
  regimeStartedAt: number    // epoch ms
  regimeDurationMs:number
  // Liquidity
  spread:          number
  buyPressure:     number    // 0..1
  sellPressure:    number    // 0..1
  volume:          number    // 0.5..2.0
  depth:           number
  speed:           number    // multiplies tick rate
  // Admin overrides (set via /admin/otc endpoints in Etapa 6)
  trendBias:       number    // -1..+1, added to drift
  // True for the first few seconds after engine boot — stepPrice() uses
  // it to suppress the random spike branch so the first post-restart
  // candles can't introduce a visible discontinuity. Flipped to false
  // by the worker once BOOT_SPIKE_GRACE_MS elapses.
  bootGrace?:      boolean
  // Provenance (Fase 3 snapshot) — updated by the tick loop so the
  // 5-second snapshot flush can persist them. lastTickAt = the tick
  // that just ran; lastCandleAt = openTime (ms) of the most recent
  // FINALIZED candle across all tfs.
  lastTickAt?:     number    // epoch ms
  lastCandleAt?:   number    // epoch ms (finalized candle openTime)
  // Fase 5 (naturalidade) — pullback state machine. When > 0, drift is
  // flipped (counter-trend) for the next N ticks to simulate the
  // natural breathe-in/breathe-out pattern real markets show during
  // trends. Not persisted in the snapshot — on restart the engine
  // just enters a fresh pullback cycle when the FSM decides.
  pullbackTicksRemaining?: number
  // M1 direction-streak tracker — enforces "max 5 consecutive same-
  // direction M1 candles" rule. Updated by the runtime when a 60s
  // candle finalises. When the streak reaches MAX_M1_SAME_DIRECTION,
  // the runtime arms a forceReverse window for the next M1.
  m1DirectionStreak?: number
  m1LastDirection?:   'UP' | 'DOWN'
  // Time-bounded counter-drift window. While Date.now() < this, stepPrice
  // injects a fixed counter-direction drift regardless of the regime's
  // own drift. Used by the streak-break rule above.
  forceReverseUntilMs?: number
  forceReverseDir?:     'UP' | 'DOWN'   // the direction we're reversing AWAY FROM
  // Per-M1-slot wick-injection guard. Stores the openTime (ms) of the
  // M1 candle we last evaluated; prevents double-injecting a wick into
  // the same slot. The runtime guarantees ≥90% of M1 candles have at
  // least one wick by checking near the end of each slot and pushing
  // the tick outside the body when no wick is present yet.
  m1WickCheckedSlot?: number
  // Post-reset history backfill — set to N (e.g. 500) by fullResetEngine.
  // The very next tick captures the open price and writes N flat historical
  // candles per timeframe immediately before the current slot, then clears
  // this counter. UX: a freshly-reset chart paints with visual context
  // instead of starting from zero. See runtime/post-reset-backfill.ts.
  pendingBackfillCount?: number
}

// Number of flat historical candles injected per timeframe right after a
// full reset. Per-timeframe (not total) — 500 5s + 500 15s + 500 30s +
// 500 60s + 500 300s = 2500 candles total per asset per reset. Sits well
// under CANDLES_PER_TF (3000) so the cache ring buffer never trims them.
export const BACKFILL_AFTER_RESET = 500

// Output of one engine step. Worker feeds this into candle builders +
// the persistence layer.
export interface OtcTick {
  assetId:   string
  price:    number      // already rounded to 5 decimals
  recordedAt: Date
}

export interface OtcCandle {
  assetId:    string
  timeframe:  number    // seconds (5/15/30/60/300)
  openTime:   Date
  open:       number
  high:       number
  low:        number
  close:      number
  tickCount:  number
  finalizedAt: Date | null  // null = still in progress
}

export const OTC_TIMEFRAMES = [5, 15, 30, 60, 300] as const
export type  OtcTimeframe = typeof OTC_TIMEFRAMES[number]

// Tick cadence: 10Hz base, modulated per asset by speedMultiplier.
export const ENGINE_BASE_HZ = 10
export const ENGINE_TICK_INTERVAL_MS = 1000 / ENGINE_BASE_HZ  // 100ms

// Candle history capped per (asset, timeframe) — the chart never asks
// for more, and the prune job keeps DB lean.
export const CANDLES_PER_TF = 3000
