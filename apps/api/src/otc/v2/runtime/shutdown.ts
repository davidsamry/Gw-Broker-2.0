// Fase 4 — graceful shutdown. Clear all intervals, do final flush of
// pending writes + runtime state + snapshot so the next boot loses
// zero context.

import { setEngineRunning } from './state-map.js'
import { tickIntervals, intervals, flushPending } from './loops.js'
import { flushRuntimeState } from '../storage/state.js'
import { flushSnapshot } from '../storage/snapshot.js'

export function stopOtcV2Worker(): void {
  for (const it of tickIntervals) clearInterval(it)
  tickIntervals.length = 0
  if (intervals.flush)      { clearInterval(intervals.flush);      intervals.flush      = null }
  if (intervals.liquidity)  { clearInterval(intervals.liquidity);  intervals.liquidity  = null }
  if (intervals.stateFlush) { clearInterval(intervals.stateFlush); intervals.stateFlush = null }
  if (intervals.gapSweep)   { clearInterval(intervals.gapSweep);   intervals.gapSweep   = null }
  if (intervals.prune)      { clearInterval(intervals.prune);      intervals.prune      = null }
  // Final flush — order matters: pending writes first (so the snapshot's
  // lastCandleTime references one of them), then state, then snapshot.
  void flushPending()
  void flushRuntimeState()
  void flushSnapshot()
  setEngineRunning(false)
}
