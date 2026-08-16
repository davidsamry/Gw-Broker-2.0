import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { publishOperationEvent } from './events.js'
import { clearLiquiditySignalsForOp } from './liquidityManipulation.js'
import { getSettings } from '../settings/service.js'

// Polls the DB for OPEN operations whose expiresAt has passed and resolves
// them. Survives restarts: on boot it catches up on any backlog from downtime.
// Concurrent-instance safe: the atomic `updateMany WHERE status='OPEN'` returns
// 0 if another worker already claimed the row, so we skip the side effects.

const POLL_INTERVAL_MS = 1000
const BATCH_SIZE       = 50

let isPolling = false

// Preço da Binance NO INSTANTE DA EXPIRAÇÃO (não o preço "agora").
//
// O worker roda em poll de 1s e pode liquidar até ~1,3s depois do expiresAt;
// usar /ticker/price (preço atual) fazia a op ser julgada por um preço que o
// usuário não viu no vencimento. Aqui pegamos o candle de 1 SEGUNDO que
// contém o expiresAt e usamos o CLOSE dele — o mesmo valor que o gráfico
// mostrava naquele segundo.
//
// Fallback para /ticker/price se o kline não vier (símbolo sem histórico de
// 1s, janela ainda não consolidada, etc.) — comportamento anterior preservado.
async function fetchBinancePriceAt(marketSymbol: string, expiresAt: Date): Promise<number | null> {
  const sym = encodeURIComponent(marketSymbol)
  const endMs = expiresAt.getTime()
  try {
    // Janela de 1s terminando no expiresAt → o último candle fechado é o do
    // segundo da expiração. limit=1 mantém a resposta mínima.
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1s`
      + `&startTime=${endMs - 1000}&endTime=${endMs}&limit=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      const rows = await res.json() as any[]
      // Formato do kline: [openTime, open, high, low, close, ...]
      const close = Number(rows?.[0]?.[4])
      if (Number.isFinite(close) && close > 0) return close
    }
  } catch {
    // cai no fallback
  }
  try {
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/ticker/price?symbol=${sym}`,
      { signal: AbortSignal.timeout(2000) },
    )
    if (!res.ok) return null
    const j = await res.json() as { price?: string }
    const p = Number(j.price)
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}

// OTC v2 exit price — Fase 8: returns the tick row's price AND
// recordedAt so the caller can log how stale the tick was vs the
// op's expiresAt. Same query as before; just richer return value.
//
// "Same row the chart's SSE has just shown the user" is the
// invariant — never resolve an op against a price the user didn't
// have a chance to see.
async function fetchOtcV2ExitTick(assetId: string, expiresAt: Date): Promise<{
  price: number; recordedAt: Date
} | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ price: Prisma.Decimal; recordedAt: Date }>>`
      SELECT price, "recordedAt" FROM otc_ticks
      WHERE "assetId" = ${assetId}
        AND "recordedAt" <= ${expiresAt}
      ORDER BY "recordedAt" DESC
      LIMIT 1
    `
    if (rows.length === 0) return null
    const p = Number(rows[0].price)
    return Number.isFinite(p) && p > 0 ? { price: p, recordedAt: rows[0].recordedAt } : null
  } catch {
    return null
  }
}

// Fase 8 — fallback when the tick stream missed expiresAt but a
// finalized candle covers that slot. Walks timeframes shortest-first
// so the close is from the smallest bar containing expiresAt (most
// precise). NEVER returns a candle whose slot is the FUTURE relative
// to expiresAt; only candles whose slot has elapsed.
const OTC_TIMEFRAMES_SEC = [5, 15, 30, 60, 300]
async function fetchOtcCandleCloseAtSlot(assetId: string, expiresAt: Date): Promise<{
  price: number; timeframe: number; openTime: Date
} | null> {
  const expiresMs = expiresAt.getTime()
  for (const tf of OTC_TIMEFRAMES_SEC) {
    try {
      const tfMs = tf * 1000
      const slotOpen = Math.floor(expiresMs / tfMs) * tfMs
      // Candle whose openTime == the slot of expiresAt. close = the
      // last tick that fell in that slot, which IS the price the chart
      // was showing when the op expired.
      const rows = await prisma.$queryRaw<Array<{ closePrice: string; openTime: Date }>>`
        SELECT "closePrice"::text, "openTime"
        FROM otc_candles
        WHERE "assetId" = ${assetId}
          AND timeframe = ${tf}
          AND "openTime" = ${new Date(slotOpen)}
        LIMIT 1
      `
      if (rows.length === 0) continue
      const p = Number(rows[0].closePrice)
      if (Number.isFinite(p) && p > 0) {
        return { price: p, timeframe: tf, openTime: rows[0].openTime }
      }
    } catch {
      // try next tf
    }
  }
  return null
}

// Fase 8 — what source the exitPrice came from. Used only for the
// per-resolution log line; doesn't affect math.
type ExitPriceSource =
  | 'binance'        // Live Binance ticker
  | 'otc_tick'       // Last otc_ticks row at or before expiresAt
  | 'otc_candle'     // Close of the otc_candles slot containing expiresAt
  | 'random'         // Last resort — small nudge so op resolves
type ExitInfo = {
  price:       number
  source:      ExitPriceSource
  // tick_age_ms: how stale the chosen source is vs the op's expiresAt.
  // For 'binance' the API is real-time (~0ms). For 'otc_tick' this is
  // expiresAt - recordedAt. For 'otc_candle' this is expiresAt - candle
  // openTime + tfMs (close of the slot). For 'random' this is 0.
  tickAgeMs:   number
  // Extra context for the log when source='otc_candle'.
  candleTf?:   number
}

async function resolveExitPrice(op: {
  assetId: string; expiresAt: Date; marketSymbol: string | null; entryPrice: Prisma.Decimal
}): Promise<ExitInfo> {
  // ── 1. BINANCE (real market) ──────────────────────────────────────
  if (op.marketSymbol) {
    const p = await fetchBinancePriceAt(op.marketSymbol, op.expiresAt)
    if (p != null) {
      return { price: p, source: 'binance', tickAgeMs: 0 }
    }
    // Binance ticker down — fall through. Real BINANCE assets shouldn't
    // ever hit otc_ticks/otc_candles (no engine running for them) so
    // we go straight to random.
    return makeRandomExit(op.entryPrice)
  }

  // ── 2. OTC tick at or before expiresAt (preferred — same row the
  //       chart's SSE has shown the user) ───────────────────────────
  const tick = await fetchOtcV2ExitTick(op.assetId, op.expiresAt)
  if (tick) {
    return {
      price:     tick.price,
      source:    'otc_tick',
      tickAgeMs: op.expiresAt.getTime() - tick.recordedAt.getTime(),
    }
  }

  // ── 3. OTC candle close for the slot containing expiresAt ──────
  // Fase 8 NEW fallback — if the tick stream missed (prune ran while
  // op resolving, etc.) but a candle finalized for the slot, use
  // its close. That's still the chart price the user would have seen
  // — much better than rolling random dice.
  const candle = await fetchOtcCandleCloseAtSlot(op.assetId, op.expiresAt)
  if (candle) {
    const tfMs = candle.timeframe * 1000
    return {
      price:     candle.price,
      source:    'otc_candle',
      tickAgeMs: op.expiresAt.getTime() - (candle.openTime.getTime() + tfMs),
      candleTf:  candle.timeframe,
    }
  }

  // ── 4. Last resort — random nudge so the op doesn't hang OPEN ──
  return makeRandomExit(op.entryPrice)
}

function makeRandomExit(entryPrice: Prisma.Decimal): ExitInfo {
  const entry = Number(entryPrice)
  const change = (Math.random() * 0.01) - 0.005
  return {
    price:     parseFloat((entry * (1 + change)).toFixed(5)),
    source:    'random',
    tickAgeMs: 0,
  }
}

async function resolveOperation(op: {
  id:           string
  accountId:    string
  assetId:      string
  assetSymbol:  string
  amount:       Prisma.Decimal
  payout:       number
  entryPrice:   Prisma.Decimal
  expiresAt:    Date
  openedAt:     Date
  direction:    'CALL' | 'PUT'
  marketSymbol: string | null
  // Per User.isFake — admin-flagged demo accounts. When true, EVERY
  // resolution returns WON regardless of price movement. Field is loaded
  // via the JOIN in tick()/resolveOperationIfExpired below; if the JOIN
  // ever fails (returns undefined), the falsy default means normal price
  // comparison applies. Fail-safe is "behave like a real user".
  isFake?:      boolean
  // Per-op liquidity-cycle outcome decided at OPEN time in
  // createOperation and persisted on the row itself. Values: 'WIN',
  // 'LOSS', or null (not a liquidity op). Reading from the row instead
  // of an in-memory Set means restarts/redeploys between open and
  // resolve don't drop the plan — the worker always honours the cycle.
  liquidityOutcome?: string | null
}) {
  try {
    const entry = Number(op.entryPrice)
    const amount = Number(op.amount)

    const exit = await resolveExitPrice(op)
    const exitPrice = parseFloat(exit.price.toFixed(5))

    // Fase 8 — divergence detection. When we used a tick, ALSO peek
    // at the candle close for the same slot. If they disagree by >0.5%
    // it means the chart and the resolution price likely diverged
    // (engine bug, stale tick, etc.) — WARN so it's visible in logs.
    // Doesn't change the resolution — exit price IS the tick that
    // was shown to the user.
    let divergenceWarn = ''
    if (exit.source === 'otc_tick' && !op.marketSymbol) {
      const candle = await fetchOtcCandleCloseAtSlot(op.assetId, op.expiresAt)
      if (candle) {
        const pct = Math.abs((exitPrice - candle.price) / candle.price) * 100
        if (pct > 0.5) {
          divergenceWarn = ` divergence_pct=${pct.toFixed(3)} candle_close=${candle.price}`
        }
      }
    }

    // ── Per-op resolution overrides ──
    //
    // STRICT gates — `=== true` / explicit string match only. Order
    // matters: isFake checked FIRST so a demo-fake user marked as
    // liquidityMode by mistake still always wins (admin shouldn't
    // combine, but we err on the safe side).
    //
    //  1. isFake — every resolution forced to WON.
    //  2. liquidity-cycle outcome — read from op.liquidityOutcome on the
    //     row (persisted at OPEN time). 'WIN' forces WON, 'LOSS' forces
    //     LOST, null/anything-else falls through. Reading from the row
    //     means the plan survives restarts between open and resolve.
    //     For OTC the candle was ALSO nudged in the matching direction
    //     at OPEN time (in-memory signal), so vela tica coerente. Even
    //     if the candle signal was lost to a restart, the OP outcome is
    //     still correct (forced from the persisted column).
    //
    // Defaults (NULL liquidityOutcome) keep the existing CALL/PUT-vs-
    // price logic untouched. NO real user without admin opt-in lands here.
    const forcedWin  = op.isFake === true || op.liquidityOutcome === 'WIN'
    const forcedLoss = !forcedWin && op.liquidityOutcome === 'LOSS'

    const won = forcedWin
      ? true
      : forcedLoss
        ? false
        : (op.direction === 'CALL' && exitPrice > entry) ||
          (op.direction === 'PUT'  && exitPrice < entry)

    // Cleanup the in-memory candle signal (vela nudge) — bounded GC for
    // the signal map. The persisted column is left untouched: it's the
    // audit trail of WHY this op resolved the way it did.
    clearLiquiditySignalsForOp(op.id)

    const profit = won ? parseFloat((amount * (op.payout / 100)).toFixed(2)) : 0

    // Atomic claim: only one worker actually resolves this op.
    const claim = await prisma.operation.updateMany({
      where: { id: op.id, status: 'OPEN' },
      data: {
        status:    won ? 'WON' : 'LOST',
        exitPrice,
        profit,
        closedAt:  new Date(),
      },
    })

    if (claim.count === 0) return // someone else already resolved it

    if (won) {
      await prisma.$transaction([
        prisma.account.update({
          where: { id: op.accountId },
          data:  { balance: { increment: amount + profit } },
        }),
        prisma.transaction.create({
          data: {
            accountId:   op.accountId,
            type:        'TRADE_WIN',
            amount:      amount + profit,
            description: `Operação encerrada: ganho de R$${profit.toFixed(2)}`,
          },
        }),
      ])

      // ── Auto-liquidez: 2 gatilhos (OR) ──────────────────────────────
      // Após CADA WIN em conta REAL (user comum, sem liquidityMode), ativa
      // liquidityMode=true + canTradeCrypto=false se QUALQUER um bater:
      //   1. LUCRO   — saldo >= bankrollBaseline × (1 + autoLiquidityProfitPct/100)
      //   2. ROLLOVER — rolloverProgress >= rolloverRequired × (autoLiquidityRolloverPct/100)
      //                 (pega o user MESMO sem atingir o lucro — regra nova)
      //
      // Skipa: isFake true · liquidityMode já true · account.type != REAL.
      // Cada gatilho tem seu próprio guard (baseline>0 / rolloverRequired>0).
      // Setar a % correspondente como 0 desliga aquele gatilho.
      //
      // Wrapped em try/catch — qualquer falha NUNCA desfaz o credit do WIN
      // (pior caso: trigger "atrasa" pra próxima op). Re-aciona se admin
      // desligar manualmente e a condição continuar valendo.
      try {
        const settings    = getSettings()
        const profitPct   = settings.autoLiquidityProfitPct
        const rolloverPct = settings.autoLiquidityRolloverPct
        if (profitPct > 0 || rolloverPct > 0) {
          const ctx = await prisma.$queryRaw<Array<{
            userId:           string
            isFake:           boolean
            liquidityMode:    boolean
            bankrollBaseline: string
            balance:          string
            accountType:      string
            rolloverRequired: string
            rolloverProgress: string
          }>>`
            SELECT u.id           AS "userId",
                   u."isFake"     AS "isFake",
                   u."liquidityMode" AS "liquidityMode",
                   u."bankrollBaseline"::text AS "bankrollBaseline",
                   a.balance::text AS balance,
                   a.type::text   AS "accountType",
                   a."rolloverRequired"::text AS "rolloverRequired",
                   a."rolloverProgress"::text AS "rolloverProgress"
            FROM accounts a
            JOIN users u ON u.id = a."userId"
            WHERE a.id = ${op.accountId}
            LIMIT 1
          `
          const row = ctx[0]
          if (
            row &&
            row.accountType === 'REAL' &&
            row.isFake === false &&
            row.liquidityMode === false
          ) {
            const baseline = Number(row.bankrollBaseline)
            const balance  = Number(row.balance)
            const rollReq  = Number(row.rolloverRequired)
            const rollProg = Number(row.rolloverProgress)

            const profitHit   = profitPct > 0 && baseline > 0 &&
              balance >= baseline * (1 + profitPct / 100)
            const rolloverHit = rolloverPct > 0 && rollReq > 0 &&
              rollProg >= rollReq * (rolloverPct / 100)

            if (profitHit || rolloverHit) {
              await prisma.$executeRaw`
                UPDATE users
                SET "liquidityMode" = TRUE,
                    "canTradeCrypto" = FALSE
                WHERE id = ${row.userId}
              `
              const why = profitHit
                ? `lucro: saldo ${balance.toFixed(2)} >= ${(baseline * (1 + profitPct / 100)).toFixed(2)} (${profitPct}% s/ banca ${baseline.toFixed(2)})`
                : `rollover: ${rollProg.toFixed(2)} >= ${(rollReq * (rolloverPct / 100)).toFixed(2)} (${rolloverPct}% de ${rollReq.toFixed(2)})`
              console.log(`[auto-liquidity] triggered user=${row.userId} — ${why}`)
            }
          }
        }
      } catch (err) {
        console.error('[auto-liquidity] check failed (non-fatal)', err)
      }
    }

    // Broadcast 'resolved' so every connected session updates its
    // open-trades list + closed-trades list + balance live. Best-effort
    // (a publish failure doesn't unwind the resolution).
    try {
      const account = await prisma.account.findUnique({
        where:  { id: op.accountId },
        select: { userId: true },
      })
      if (account) {
        const now = new Date()
        publishOperationEvent({
          kind:   'resolved',
          userId: account.userId,
          op: {
            id:          op.id,
            accountId:   op.accountId,
            assetId:     op.assetId,
            assetSymbol: op.assetSymbol,
            direction:   op.direction,
            amount:      amount.toFixed(2),
            payout:      op.payout,
            profit:      profit.toFixed(2),
            status:      won ? 'WON' : 'LOST',
            entryPrice:  entry.toFixed(5),
            exitPrice:   exitPrice.toFixed(5),
            expiresAt:   op.expiresAt.toISOString(),
            openedAt:    op.openedAt.toISOString(),
            closedAt:    now.toISOString(),
          },
        })
      }
    } catch (err) {
      console.error('[operations] publish resolved event failed', err)
    }

    // Single structured log per resolution — grepable for auditing
    // resolution quality. Should see ~0% source=random in healthy runs.
    // fake / liquidity_win / liquidity_loss tags appear only when the
    // override actually changed the outcome. isFake fires fake=true even
    // if the liquidity cycle also picked WIN (isFake takes precedence).
    const tfStr        = exit.candleTf ? ` candle_tf=${exit.candleTf}` : ''
    const fakeStr      = op.isFake === true  ? ' fake=true' : ''
    const liqWinStr    = forcedWin && op.isFake !== true ? ' liquidity_win=true'  : ''
    const liqLossStr   = forcedLoss                       ? ' liquidity_loss=true' : ''
    console.log(
      `[op-resolve] op=${op.id} asset=${op.assetId} dir=${op.direction}` +
      ` entry=${entry.toFixed(5)} exit=${exitPrice.toFixed(5)}` +
      ` source=${exit.source} tick_age_ms=${exit.tickAgeMs}${tfStr}` +
      ` won=${won} profit=${profit.toFixed(2)}${fakeStr}${liqWinStr}${liqLossStr}` +
      divergenceWarn,
    )
  } catch (err) {
    console.error('[worker] failed to resolve', op.id, err)
  }
}

async function tick() {
  if (isPolling) return
  isPolling = true
  try {
    const expiredRaw = await prisma.operation.findMany({
      where:   { status: 'OPEN', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take:    BATCH_SIZE,
      select:  {
        id: true, accountId: true, assetId: true, assetSymbol: true, amount: true, payout: true,
        entryPrice: true, expiresAt: true, openedAt: true, direction: true, marketSymbol: true,
        liquidityOutcome: true,
        // JOIN to read User.isFake (still in-memory at the user level,
        // not per-op). `as any` on the inner select because the Prisma
        // client may lag schema briefly post-deploy — the runtime query
        // is fine, the column exists post-migration.
        account: { select: { user: { select: { isFake: true } as any } } },
      } as any,
    })

    if (expiredRaw.length === 0) return

    // Flatten isFake onto the op so resolveOperation's shape stays flat.
    // liquidityOutcome is already a top-level column.
    const expired = (expiredRaw as any[]).map((o) => ({
      ...o,
      isFake: o.account.user.isFake,
    }))

    // Resolve in parallel — each call's atomic claim prevents double-processing.
    await Promise.all(expired.map(resolveOperation))
  } catch (err) {
    console.error('[worker] poll error', err)
  } finally {
    isPolling = false
  }
}

// JIT resolution — called by GET /operations/:id so a user's read after
// expiry doesn't have to wait for the next worker tick (~500ms avg).
// Reuses the same resolveOperation path; the atomic claim inside it
// ensures we don't double-process if the worker picks the same op
// concurrently. Returns silently when the op isn't found, isn't OPEN
// yet, or hasn't expired — nothing to do.
export async function resolveOperationIfExpired(operationId: string): Promise<void> {
  const raw = await prisma.operation.findFirst({
    where: {
      id:        operationId,
      status:    'OPEN',
      expiresAt: { lte: new Date() },
    },
    // Same `as any` rationale as the worker tick — keep typecheck green
    // on a stale Prisma client; runtime is correct post-migration.
    select: {
      id: true, accountId: true, assetId: true, assetSymbol: true, amount: true, payout: true,
      entryPrice: true, expiresAt: true, openedAt: true, direction: true, marketSymbol: true,
      liquidityOutcome: true,
      account: { select: { user: { select: { isFake: true } as any } } },
    } as any,
  })
  if (!raw) return
  const rawAny = raw as any
  await resolveOperation({
    ...rawAny,
    isFake: rawAny.account.user.isFake,
  })
}

let intervalId: ReturnType<typeof setInterval> | null = null

export function startExpirationWorker(): void {
  if (intervalId) return
  // Catch up immediately on boot (handles ops that expired during downtime).
  void tick()
  intervalId = setInterval(tick, POLL_INTERVAL_MS)
}

export function stopExpirationWorker(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
