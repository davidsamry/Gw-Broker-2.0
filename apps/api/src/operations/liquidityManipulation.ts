// Per-op liquidity manipulation state — in-memory only.
//
// Used by the User.liquidityMode flow ("modo liquidez") to coordinate
// between createOperation (where the 70% roll happens) and either:
//   - resolveOperation (Binance assets — force-loss in the resolver,
//     same "silent" behaviour as before)
//   - the OTC tick loop (OTC assets — register a signal that pulls the
//     close in the opposite direction, so the user loses on a coherent
//     vela vermelha, not a "vela verde mas perdeu" mismatch).
//
// Design choices:
//  - State is in-memory: Map<opId, true> and Map<assetId, signal[]>.
//    Lost on restart — fail-safe is "resolve naturally", which is the
//    same outcome the system had before any of this existed.
//  - 70% roll happens ONCE per op (at create), not at resolve. Same op
//    can never re-roll partway through; signal + forced-loss flag are
//    paired by opId.
//  - Auto-cleanup on resolve + periodic GC for orphans (op never
//    resolved for some reason → entry sits forever otherwise).
//  - Strict opt-in: every public function returns falsy/empty by
//    default. NO real user without an explicit admin
//    User.liquidityMode = true ever touches this code path.

export interface LiquiditySignal {
  opId:         string
  assetId:      string
  // The DIRECTION WE WANT THE CANDLE TO CLOSE. If user opened CALL we
  // want the candle to close DOWN, so direction = 'PUT' here. The OTC
  // tick loop reads this same direction key the admin signals use.
  direction:    'CALL' | 'PUT'
  // Slot end-time ms epoch — the M1 (60s) slot containing the op's
  // expiresAt. Manipulation tick loop only nudges in the last
  // NUDGE_WINDOW_MS of this slot.
  slotEndMs:    number
  expiresAtMs:  number
}

// ── Per-op force-loss flag (used by resolveOperation) ───────────────────
// Set at op-create time when the 70% roll picks "lose". Read at resolve
// time by the worker. NOT a re-roll — pre-decided outcome.
const forceLossOpIds = new Set<string>()

export function markOpForcedLoss(opId: string): void {
  forceLossOpIds.add(opId)
}

export function isOpForcedLoss(opId: string): boolean {
  return forceLossOpIds.has(opId)
}

export function clearOpForcedLoss(opId: string): void {
  forceLossOpIds.delete(opId)
}

// ── Per-asset liquidity signals (used by OTC tick loop) ─────────────────
// Bucket by assetId so the per-tick lookup is O(signalsForThisAsset),
// matching the admin-signal cache shape in otc/v2/runtime/manipulation.ts.
const liquiditySignalsByAsset = new Map<string, LiquiditySignal[]>()

export function registerLiquiditySignal(s: LiquiditySignal): void {
  const arr = liquiditySignalsByAsset.get(s.assetId) ?? []
  arr.push(s)
  // Keep sorted by slotEndMs ASC so consumers can early-exit when
  // scanning for the slot they care about.
  arr.sort((a, b) => a.slotEndMs - b.slotEndMs)
  liquiditySignalsByAsset.set(s.assetId, arr)
}

export function getLiquiditySignalsForAsset(assetId: string): LiquiditySignal[] {
  return liquiditySignalsByAsset.get(assetId) ?? []
}

export function clearLiquiditySignalsForOp(opId: string): void {
  for (const [assetId, arr] of liquiditySignalsByAsset) {
    const filtered = arr.filter((s) => s.opId !== opId)
    if (filtered.length === 0) liquiditySignalsByAsset.delete(assetId)
    else                       liquiditySignalsByAsset.set(assetId, filtered)
  }
}

// ── GC — runs every 5 min, drops anything older than 1 hour ─────────────
// Catches orphans: ops that never resolved (worker crashed mid-resolve,
// admin canceled out-of-band, etc.). 1h is comfortably longer than the
// max op duration (900s) so a "still pending" op never gets GC'd by
// mistake.
const GC_INTERVAL_MS = 5 * 60_000
const MAX_SIGNAL_AGE_MS = 60 * 60_000

let gcTimer: ReturnType<typeof setInterval> | null = null

export function startLiquidityGc(): void {
  if (gcTimer) return
  gcTimer = setInterval(() => {
    const cutoff = Date.now() - MAX_SIGNAL_AGE_MS
    let dropped = 0
    for (const [assetId, arr] of liquiditySignalsByAsset) {
      const fresh = arr.filter((s) => s.expiresAtMs > cutoff)
      if (fresh.length === arr.length) continue
      dropped += arr.length - fresh.length
      if (fresh.length === 0) liquiditySignalsByAsset.delete(assetId)
      else                    liquiditySignalsByAsset.set(assetId, fresh)
    }
    // forceLoss Set has no timestamp — capped via the same op cleanup
    // path called from resolveOperation. GC for that would require
    // tracking insertion time per id; the set is small (1 entry per
    // pending op, ~minutes lifetime) so the cost of NOT GC-ing it is
    // negligible vs the complexity.
    if (dropped > 0) console.log(`[liquidity] gc dropped ${dropped} stale signals`)
  }, GC_INTERVAL_MS)
}

export function stopLiquidityGc(): void {
  if (gcTimer) {
    clearInterval(gcTimer)
    gcTimer = null
  }
}
