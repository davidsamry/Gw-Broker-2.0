// Fase 9 — in-process diagnostics for the admin panel. Tracks
// recent gap-fill events so the operator can see at a glance
// whether the engine had to heal gaps overnight.
//
// Ring-buffered (in-memory only) — restart clears the history.
// That's fine: this is for live ops visibility, not audit.

export interface GapFillEvent {
  ts:          number    // epoch ms
  assetId:     string
  tf:          number
  slotsFilled: number
}

const RECENT_GAP_FILLS_CAP = 100
const recentGapFills: GapFillEvent[] = []

export function recordGapFill(assetId: string, tf: number, slotsFilled: number): void {
  recentGapFills.push({ ts: Date.now(), assetId, tf, slotsFilled })
  while (recentGapFills.length > RECENT_GAP_FILLS_CAP) {
    recentGapFills.shift()
  }
}

export function listRecentGapFills(limit = 10): GapFillEvent[] {
  return recentGapFills.slice(-limit).reverse()  // newest first
}

// Count of fills in the last 24h — admin header badge.
export function gapFillCountLast24h(): number {
  const cutoff = Date.now() - 24 * 60 * 60_000
  let count = 0
  for (const e of recentGapFills) if (e.ts > cutoff) count += e.slotsFilled
  return count
}
