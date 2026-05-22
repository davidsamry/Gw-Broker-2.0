import { prisma } from '../prisma.js'
import type { CreateOperationInput } from './schema.js'

export async function createOperation(userId: string, input: CreateOperationInput) {
  const account = await prisma.account.findUnique({ where: { id: input.accountId } })

  if (!account || account.userId !== userId) throw new Error('ACCOUNT_NOT_FOUND')

  const balance = Number(account.balance)
  if (balance < input.amount) throw new Error('INSUFFICIENT_BALANCE')

  const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000)

  const [operation] = await prisma.$transaction([
    prisma.operation.create({
      data: {
        accountId:   input.accountId,
        assetId:     input.assetId,
        assetSymbol: input.assetSymbol,
        direction:   input.direction,
        amount:      input.amount,
        payout:      input.payout,
        entryPrice:  input.entryPrice,
        expiresAt,
      },
    }),
    prisma.account.update({
      where: { id: input.accountId },
      data: { balance: { decrement: input.amount } },
    }),
    prisma.transaction.create({
      data: {
        accountId:   input.accountId,
        type:        'TRADE_LOSS',
        amount:      -input.amount,
        description: `Operação aberta: ${input.assetSymbol} ${input.direction}`,
      },
    }),
  ])

  scheduleExpiry(operation.id, input.accountId, input.amount, input.payout, input.entryPrice, input.direction, input.expiresInSeconds)

  return operation
}

function scheduleExpiry(
  operationId: string,
  accountId: string,
  amount: number,
  payout: number,
  entryPrice: number,
  direction: string,
  expiresInSeconds: number,
) {
  setTimeout(async () => {
    try {
      const op = await prisma.operation.findUnique({ where: { id: operationId } })
      if (!op || op.status !== 'OPEN') return

      // Simulate exit price: random ±0.5% movement
      const change = (Math.random() * 0.01) - 0.005
      const exitPrice = parseFloat((entryPrice * (1 + change)).toFixed(5))

      const won =
        (direction === 'CALL' && exitPrice > entryPrice) ||
        (direction === 'PUT'  && exitPrice < entryPrice)

      const profit = won ? parseFloat((amount * (payout / 100)).toFixed(2)) : 0

      await prisma.$transaction([
        prisma.operation.update({
          where: { id: operationId },
          data: {
            status:    won ? 'WON' : 'LOST',
            exitPrice,
            profit,
            closedAt:  new Date(),
          },
        }),
        ...(won
          ? [
              prisma.account.update({
                where: { id: accountId },
                data: { balance: { increment: amount + profit } },
              }),
              prisma.transaction.create({
                data: {
                  accountId,
                  type:        'TRADE_WIN',
                  amount:      amount + profit,
                  description: `Operação encerrada: ganho de R$${profit.toFixed(2)}`,
                },
              }),
            ]
          : []),
      ])
    } catch (err) {
      console.error('[expiry] erro ao resolver operação:', operationId, err)
    }
  }, expiresInSeconds * 1000)
}

export async function listOperations(userId: string, accountId?: string) {
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { id: true },
  })
  const accountIds = accounts.map((a: { id: string }) => a.id)

  if (accountId && !accountIds.includes(accountId)) throw new Error('ACCOUNT_NOT_FOUND')

  return prisma.operation.findMany({
    where: { accountId: accountId ? accountId : { in: accountIds } },
    orderBy: { openedAt: 'desc' },
    take: 50,
  })
}

export async function getOperation(userId: string, operationId: string) {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    include: { account: { select: { userId: true } } },
  })
  if (!op || op.account.userId !== userId) throw new Error('NOT_FOUND')
  return op
}
