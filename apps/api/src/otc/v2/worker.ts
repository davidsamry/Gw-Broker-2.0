// OTC v2 worker — Fase 4 thin façade.
//
// The implementation has been split into clear layers under v2/:
//   engine/      — pure math (pricing, candle builder)
//   stream/      — event bus for SSE consumers
//   storage/     — Prisma reads/writes (assets, candles, ticks,
//                  snapshot, legacy state tables)
//   recovery/    — bootstrap, backfill, gap sweep, boot-time state
//                  recovery (Fase 2/3)
//   admin/       — admin-facing live state + mutators
//   runtime/     — interval orchestration (boot, shutdown, loops,
//                  in-memory state Maps)
//
// This file is now just the public façade — main.ts and the rest of
// the codebase keep importing from `./otc/v2/worker.js` so the cleanup
// didn't ripple across the project. New code should prefer importing
// directly from the appropriate layer (e.g., admin/live-state.js for
// the admin API).

export { startOtcV2Worker, reloadOtcV2Assets } from './runtime/boot.js'
export { stopOtcV2Worker }                     from './runtime/shutdown.js'
export { msSinceBoot, isWithinBootGrace }      from './runtime/loops.js'
export {
  getCachedCandles, getCurrentPrice, listEngineAssets,
} from './runtime/state-map.js'
export {
  getAssetLiveState, listAssetLiveStates,
  setAssetTrendBias, resetAssetState,
  type OtcAssetLiveState,
} from './admin/live-state.js'
