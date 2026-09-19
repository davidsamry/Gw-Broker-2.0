// In-process pub/sub for operation lifecycle events.
//
// Why: when a trade is created or resolved we need every open session of
// the same user to update its UI immediately — multi-device sync, plus
// the case where a bot fires a trade via /bot/v1/trade and the user's
// browser tab should show it pop in.
//
// Scope: single-process bus. If we ever scale the API horizontally we'd
// swap this for Redis Pub/Sub (or the OTC v2 stream registry's pattern),
// but the EVENT SHAPE here is the contract — callers don't need to
// change at that point.

import { EventEmitter } from 'node:events'

export interface OperationEvent {
  /** Lifecycle phase. 'created' fires from service.createOperation,
   *  'resolved' fires from worker.resolveOperation after settlement. */
  kind:   'created' | 'resolved'
  userId: string
  /** Subset of the Operation row the frontend needs. Mirrors the
   *  serialiser shape used by /auth/me + /operations. */
  op: {
    id:          string
    accountId:   string
    assetId:     string
    assetSymbol: string
    direction:   'CALL' | 'PUT'
    amount:      string       // Decimal serialised
    payout:      number
    profit:      string | null
    // DRAW = empate (saída igual à entrada): entrada devolvida, profit 0.
    status:      'OPEN' | 'WON' | 'LOST' | 'CANCELLED' | 'DRAW'
    entryPrice:  string
    exitPrice?:  string | null
    expiresAt:   string       // ISO
    openedAt:    string       // ISO
    closedAt?:   string | null
  }
}

class OperationsBus extends EventEmitter {
  constructor() {
    super()
    // Each SSE connection adds 1 listener. Plenty of headroom — at
    // 5k concurrent web sessions we'd need 5k. EventEmitter warns at
    // 10 by default; we cap explicitly.
    this.setMaxListeners(20_000)
  }
}

const bus = new OperationsBus()

/** Publish a lifecycle event. Fan-out is delivered to every subscriber;
 *  filtering by userId happens on the listener side. */
export function publishOperationEvent(e: OperationEvent): void {
  bus.emit('op', e)
}

/** Subscribe to events for ONE user. Returns the unsubscribe function. */
export function subscribeToUserOperations(
  userId:   string,
  listener: (e: OperationEvent) => void,
): () => void {
  const wrapper = (e: OperationEvent) => {
    if (e.userId !== userId) return
    listener(e)
  }
  bus.on('op', wrapper)
  return () => { bus.off('op', wrapper) }
}

// ── Evento de saldo ──────────────────────────────────────────────────────
// Emitido por QUALQUER rota que altere o saldo de uma conta fora do fluxo
// da própria operação (que já chega via 'created'/'resolved'): ajuste do
// admin, depósito confirmado, saque debitado/estornado, bônus, compra de
// copy. A aba do usuário recebe e chama /accounts — o servidor continua
// sendo a fonte da verdade; o evento só diz "vai buscar de novo".
//
// Sem isto, o header ficava com o saldo velho até o reload ou a próxima
// operação. Era o que acontecia quando o admin mudava o saldo.
//
// ATENÇÃO: barramento em memória. Funciona porque a API roda num
// container só. Se escalar para várias instâncias, este emit precisa
// passar pelo Redis (pub/sub) para alcançar a instância que segura a
// conexão SSE do usuário.
export function publishBalanceEvent(userId: string): void {
  bus.emit('balance', { userId })
}

export function subscribeToUserBalance(
  userId:   string,
  listener: () => void,
): () => void {
  const wrapper = (e: { userId: string }) => {
    if (e.userId !== userId) return
    listener()
  }
  bus.on('balance', wrapper)
  return () => { bus.off('balance', wrapper) }
}

// Atalho para os pontos que alteram saldo. Aceita o que estiver à mão
// naquele ponto do código — userId, accountId, ou o id do depósito /
// saque / operação — e resolve o dono com uma consulta. Best-effort e
// sem await: nunca pode falhar a operação de dinheiro por causa de um
// aviso de UI.
export function notifyBalanceChanged(ref: {
  userId?:       string | null
  accountId?:    string | null
  depositId?:    string | null
  withdrawalId?: string | null
  operationId?:  string | null
  copyOpId?:     string | null
}): void {
  void (async () => {
    try {
      let userId = ref.userId ?? null
      if (!userId) {
        const { prisma } = await import('../prisma.js')
        const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
          SELECT a."userId" FROM accounts a
          WHERE a.id = COALESCE(
            ${ref.accountId ?? null},
            (SELECT "accountId" FROM deposits    WHERE id = ${ref.depositId    ?? null}),
            (SELECT "accountId" FROM withdrawals WHERE id = ${ref.withdrawalId ?? null}),
            (SELECT "accountId" FROM operations  WHERE id = ${ref.operationId  ?? null}),
            (SELECT a2.id FROM copy_trade_operations co
               JOIN accounts a2 ON a2."userId" = co."userId" AND a2.type = 'REAL'
              WHERE co.id = ${ref.copyOpId ?? null})
          )
          LIMIT 1
        `
        userId = rows[0]?.userId ?? null
      }
      if (userId) publishBalanceEvent(userId)
    } catch (err) {
      console.error('[balance-event] falhou (não-fatal)', err)
    }
  })()
}
