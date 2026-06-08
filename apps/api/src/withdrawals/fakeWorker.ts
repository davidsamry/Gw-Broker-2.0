import { prisma } from '../prisma.js'

// Fake-account auto-approval worker.
//
// Saques de usuários marcados como User.isFake=true sao APROVADOS
// AUTOMATICAMENTE 60s apos a criacao. Saldo ja' foi debitado no
// createWithdrawal — o worker so' flipa o status pra COMPLETED.
//
// Por que worker e nao setTimeout? Sobrevive a restart: se a API cair
// durante o intervalo de 1min, na hora que subir o worker pega o
// pendente e completa.
//
// O saque NAO aparece na pagina /admin/saques (filtrado por isFake=false
// no list query). E nao gera email — admin nao precisa ver, user nao
// precisa receber notificacao (e' so' visual interno).
//
// Concurrent-instance safe: o UPDATE ... WHERE status='PENDING' so'
// modifica linhas que ainda estao pendentes — se outro worker (ou um
// admin clicando "aprovar" via algum atalho) ja' mudou, o nosso UPDATE
// retorna 0 rows e nao faz nada.

const POLL_INTERVAL_MS = 10_000   // 10s — sobra de tempo pra 60s nao atrasar muito
// NOTE: o intervalo do Postgres e' hardcoded ('60 seconds') na query
// porque $executeRaw nao aceita parametros dentro de INTERVAL '...'.
// Se mudar este valor, ajustar a string SQL abaixo.

let isPolling = false
let intervalId: ReturnType<typeof setInterval> | null = null

async function tick() {
  if (isPolling) return
  isPolling = true
  try {
    // UPDATE atomico — pega todos os PENDING de fakes com idade >= 60s
    // e marca como COMPLETED numa unica query.
    const result = await prisma.$executeRaw`
      UPDATE withdrawals w
      SET status        = 'COMPLETED'::"WithdrawalStatus",
          "processedAt" = NOW(),
          "updatedAt"   = NOW(),
          notes         = CASE
                            WHEN w.notes IS NULL THEN 'Auto-aprovado (conta fake)'
                            ELSE w.notes || ' · Auto-aprovado (conta fake)'
                          END
      FROM accounts a
      JOIN users u ON u.id = a."userId"
      WHERE w."accountId" = a.id
        AND w.status      = 'PENDING'::"WithdrawalStatus"
        AND u."isFake"    = TRUE
        AND w."createdAt" <= NOW() - INTERVAL '60 seconds'
    `
    if (result > 0) {
      console.log(`[fake-withdrawal-worker] auto-aprovados ${result} saque(s)`)
    }
  } catch (err) {
    console.error('[fake-withdrawal-worker] tick failed', err)
  } finally {
    isPolling = false
  }
}

export function startFakeWithdrawalWorker(): void {
  if (intervalId) return
  // Catch-up imediato no boot — pega tudo que acumulou em downtime.
  void tick()
  intervalId = setInterval(tick, POLL_INTERVAL_MS)
}

export function stopFakeWithdrawalWorker(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
