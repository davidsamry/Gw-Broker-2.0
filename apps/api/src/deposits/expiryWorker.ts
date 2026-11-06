import { prisma } from '../prisma.js'

// Expiração de depósitos PIX abandonados.
//
// PROBLEMA QUE ISSO RESOLVE
// O QR code do PIX vence no gateway (na BSPay vira "Expirado" em ~1h). Do
// nosso lado nada acontecia: a linha ficava PENDING pra sempre. Em 06/11/2026
// havia 169 depósitos PENDING com mais de 6h, somando R$ 33.147 — o mais
// antigo de 30/05/2026. Isso deixa a aba "Pendentes" do admin inútil: ela
// mostrava 171 quando só 2 depósitos estavam de fato esperando pagamento.
// (O card "Depósitos Gerados" conta todos os status e não muda com isso.)
//
// Até aqui a única coisa que limpava esses registros era o auto-cancel do
// createPixDeposit, e só quando o MESMO usuário gerava outro PIX. Quem gerou
// um QR e sumiu deixava a linha presa indefinidamente.
//
// POR QUE 24 HORAS
// Bem mais folgado que o vencimento real do QR (~1h), de propósito: nunca
// queremos cancelar algo que o usuário ainda consiga pagar. O alvo aqui é
// lixo de dias/meses atrás, não apertar o prazo de ninguém.
//
// E SE ALGUÉM PAGAR DEPOIS?
// Está coberto. confirmDepositById reativa depósito CANCELLED quando o
// gateway confirma pagamento — o saldo entra normalmente. Cancelar cedo
// demais aqui não custa dinheiro a ninguém, só gera um log de reativação.
//
// Usamos CANCELLED porque o enum DepositStatus não tem EXPIRED; a nota deixa
// claro no admin que foi expiração automática, e não cancelamento manual.

const POLL_INTERVAL_MS = 10 * 60_000   // 10 min — não tem pressa nenhuma
// NOTE: a idade está hardcoded ('24 hours') na query porque $executeRaw não
// aceita parâmetro dentro de INTERVAL '...'. Mudou aqui, muda lá embaixo.
const IDADE = '24 horas'

let isPolling = false
let intervalId: ReturnType<typeof setInterval> | null = null

async function tick() {
  if (isPolling) return
  isPolling = true
  try {
    // Mesma ordem do auto-cancel do createPixDeposit: primeiro os grants de
    // bônus pendurados nesses depósitos, depois os depósitos. Um grant
    // PENDING preso a um depósito que nunca vai ser pago ficaria órfão
    // esperando uma confirmação que não vem.
    const grants = await prisma.$executeRaw`
      UPDATE bonus_grants
      SET status = 'CANCELLED'::"BonusGrantStatus", "cancelledAt" = NOW()
      WHERE status = 'PENDING'::"BonusGrantStatus"
        AND "depositId" IN (
          SELECT id FROM deposits
          WHERE status = 'PENDING'::"DepositStatus"
            AND "createdAt" <= NOW() - INTERVAL '24 hours'
        )
    `

    // UPDATE atômico: só toca linha que ainda está PENDING, então rodar duas
    // instâncias ao mesmo tempo não duplica nada.
    const deps = await prisma.$executeRaw`
      UPDATE deposits
      SET status      = 'CANCELLED'::"DepositStatus",
          "updatedAt" = NOW(),
          notes       = COALESCE(notes, '') || ' [expirado automaticamente: QR vencido sem pagamento]'
      WHERE status = 'PENDING'::"DepositStatus"
        AND "createdAt" <= NOW() - INTERVAL '24 hours'
    `

    if (deps > 0) {
      console.log(
        `[deposit-expiry-worker] ${deps} depósito(s) PIX expirado(s) ` +
        `(sem pagamento há mais de ${IDADE}) · ${grants} bônus pendente(s) cancelado(s) junto`,
      )
    }
  } catch (err) {
    console.error('[deposit-expiry-worker] tick failed', err)
  } finally {
    isPolling = false
  }
}

export function startDepositExpiryWorker(): void {
  if (intervalId) return
  // Catch-up no boot — a primeira passada limpa todo o acúmulo histórico.
  void tick()
  intervalId = setInterval(tick, POLL_INTERVAL_MS)
}

export function stopDepositExpiryWorker(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
