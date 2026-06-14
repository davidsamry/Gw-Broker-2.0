import { prisma } from '../prisma.js'
import { restartDueCycles, settleCopyOp } from './service.js'

// ── Copy worker — liquida as operações de copy agendadas ────────────────────
//
// Cada op criada em generateCopyOps fica PENDING com um scheduledAt (1ª em
// 1min, demais a cada 30min). Este worker, a cada 30s, pega as que já venceram
// (scheduledAt <= now) cuja assinatura ainda está ACTIVE, e LIQUIDA cada uma
// ATOMICAMENTE (uma CTE por op):
//   - WIN  → credita +amount no saldo da conta REAL
//   - LOSS → debita -LEAST(amount, saldo) (respeita o CHECK balance >= 0;
//            nunca deixa negativo)
//   - marca a op SETTLED + grava o pnl real aplicado
//   - lança COPY_RESULT no extrato (transactions)
//
// Idempotente / safe pra múltiplas instâncias em DOIS níveis:
//   - anti-double-settle: o UPDATE da op só pega status='PENDING'; a 2ª query
//     pega 0 linhas e a CTE vira no-op (nada de saldo dobrado).
//   - correção do saldo sob corrida: settleOne TRAVA a conta (FOR UPDATE) e
//     calcula o cap do LOSS contra o saldo já travado, então 2 settles da mesma
//     conta serializam e o débito nunca tenta negativar.
//
// IMPORTANTE: como mexe em saldo REAL, segue o mesmo guard de main.ts — só
// roda em produção (ou local SEM DISABLE_BACKGROUND_WORKERS). O .env local
// aponta pro banco de PROD, então este worker fica DESLIGADO local.

const POLL_INTERVAL_MS = 30_000
const BATCH_LIMIT      = 200

let isPolling = false
let intervalId: ReturnType<typeof setInterval> | null = null

interface DueOp {
  id:         string
  result:     string
  traderName: string
}

// Liquida TODA op vencida (PENDING, scheduledAt <= now) via settleCopyOp —
// INDEPENDENTE do status da assinatura. Assim, se o usuário CANCELAR, as
// operações restantes do ciclo ainda liquidam nos horários agendados (perdas
// garantidas, sem despejar tudo de uma vez). Cancelar só barra NOVOS ciclos
// (restartDueCycles, que exige status ACTIVE).
export async function settleDueCopyOps(): Promise<number> {
  const due = await prisma.$queryRaw<DueOp[]>`
    SELECT o.id, o.result, ct.name AS "traderName"
      FROM copy_trade_operations o
      JOIN copy_traders ct ON ct.id = o."traderId"
     WHERE o.status = 'PENDING'
       AND o."scheduledAt" <= NOW()
     ORDER BY o."scheduledAt" ASC
     LIMIT ${BATCH_LIMIT}
  `
  let settled = 0
  for (const op of due) {
    try {
      await settleCopyOp(op.id, op.result, op.traderName)
      settled++
    } catch (err) {
      console.error('[copy-worker] settle falhou', { opId: op.id, err })
    }
  }
  return settled
}

async function tick() {
  if (isPolling) return
  isPolling = true
  try {
    const n = await settleDueCopyOps()
    if (n > 0) console.log(`[copy-worker] liquidadas ${n} operação(ões) de copy`)
    // Reinicia ciclos vencidos (novo ciclo 24h após o anterior terminar).
    const r = await restartDueCycles()
    if (r > 0) console.log(`[copy-worker] reiniciados ${r} ciclo(s) de copy`)
  } catch (err) {
    console.error('[copy-worker] tick falhou', err)
  } finally {
    isPolling = false
  }
}

export function startCopyWorker(): void {
  if (intervalId) return
  // Pre-check: o settle INSERE 'COPY_RESULT' no extrato. Se a migration do enum
  // não tiver aplicado (ex.: `migrate deploy` falhou e foi mascarado no boot do
  // container), NÃO liga o worker — senão TODA liquidação falharia em silêncio
  // (feature de dinheiro real). Melhor não liquidar do que liquidar quebrado.
  void (async () => {
    try {
      const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'TransactionType' AND e.enumlabel = 'COPY_RESULT'
        ) AS ok
      `
      if (!rows[0]?.ok) {
        console.error('[copy-worker] ABORTADO: enum TransactionType.COPY_RESULT ausente no banco — rode `prisma migrate deploy`. Worker NÃO iniciado.')
        return
      }
    } catch (err) {
      console.error('[copy-worker] pre-check do enum falhou — worker NÃO iniciado', err)
      return
    }
    if (intervalId) return
    void tick()  // catch-up imediato no boot
    intervalId = setInterval(tick, POLL_INTERVAL_MS)
  })()
}

export function stopCopyWorker(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
