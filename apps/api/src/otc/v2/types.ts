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
}

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
