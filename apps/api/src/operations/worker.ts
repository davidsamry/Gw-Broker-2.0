import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'

// Polls the DB for OPEN operations whose expiresAt has passed and resolves
// them. Survives restarts: on boot it catches up on any backlog from downtime.
// Concurrent-instance safe: the atomic `updateMany WHERE status='OPEN'` returns
// 0 if another worker already claimed the row, so we skip the side effects.

const POLL_INTERVAL_MS = 1000
const BATCH_SIZE       = 50

let isPolling = false

async function fetchBinanceLastPrice(marketSymbol: string): Promise<number | null> {
  try {
    const url = `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(marketSymbol)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    const j = await res.json() as { price?: string }
    const p = Number(j.price)
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}

// OTC v2 exit price: the tick recorded AT or just before the op's
// expiresAt — same row the chart's SSE has just shown to the user.
// Source of truth for the new 5 OTC assets.
async function fetchOtcV2ExitPrice(assetId: string, expiresAt: Date): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ price: Prisma.Decimal }>>`
      SELECT price FROM otc_ticks
      WHERE "assetId" = ${assetId}
        AND "recordedAt" <= ${expiresAt}
      ORDER BY "recordedAt" DESC
      LIMIT 1
    `
    if (rows.length === 0) return null
    const p = Number(rows[0].price)
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}

async function resolveOperation(op: {
  id:           string
  accountId:    string
  assetId:      string
  amount:       Prisma.Decimal
  payout:       number
  entryPrice:   Prisma.Decimal
  expiresAt:    Date
  direction:    'CALL' | 'PUT'
  marketSymbol: string | null
}) {
  try {
    const entry = Number(op.entryPrice)
    const amount = Number(op.amount)

    // exitPrice resolution order:
    //   1. BINANCE → public ticker (real market close).
    //   2. OTC v2  → otc_ticks (most recent ≤ expiresAt) — same source
    //                the chart's SSE shows to the user.
    //   3. Fallback → small random nudge so the op still resolves and
    //                doesn't hang OPEN forever.
    let exitPrice: number | null = null
    if (op.marketSymbol) {
      exitPrice = await fetchBinanceLastPrice(op.marketSymbol)
    } else {
      exitPrice = await fetchOtcV2ExitPrice(op.assetId, op.expiresAt)
    }
    if (exitPrice == null) {
      const change = (Math.random() * 0.01) - 0.005
      exitPrice = parseFloat((entry * (1 + change)).toFixed(5))
    } else {
      exitPrice = parseFloat(exitPrice.toFixed(5))
    }

    const won =
      (op.direction === 'CALL' && exitPrice > entry) ||
      (op.direction === 'PUT'  && exitPrice < entry)

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
    }
  } catch (err) {
    console.error('[worker] failed to resolve', op.id, err)
  }
}

async function tick() {
  if (isPolling) return
  isPolling = true
  try {
    const expired = await prisma.operation.findMany({
      where:   { status: 'OPEN', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take:    BATCH_SIZE,
      select:  {
        id: true, accountId: true, assetId: true, amount: true, payout: true,
        entryPrice: true, expiresAt: true, direction: true, marketSymbol: true,
      },
    })

    if (expired.length === 0) return

    // Resolve in parallel — each call's atomic claim prevents double-processing.
    await Promise.all(expired.map(resolveOperation))
  } catch (err) {
    console.error('[worker] poll error', err)
  } finally {
    isPolling = false
  }
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
