// One-shot: confirma um saque pelo prefixo do ID (CANCELLED → COMPLETED)
// SEM mexer no saldo. Uso: tsx scripts/confirm-withdrawal.ts <prefix>
import 'dotenv/config'
import { prisma } from '../src/prisma.js'

const prefix = process.argv[2]
if (!prefix || prefix.length < 6) {
  console.error('Uso: tsx scripts/confirm-withdrawal.ts <prefix-id-min-6-chars>')
  process.exit(1)
}

const matches = await prisma.$queryRaw<Array<{
  id: string; status: string; amount: string; createdAt: Date; userName: string; userEmail: string
}>>`
  SELECT w.id, w.status::text AS status, w.amount::text AS amount, w."createdAt",
         u.name AS "userName", u.email AS "userEmail"
  FROM withdrawals w
  JOIN accounts a ON a.id = w."accountId"
  JOIN users u    ON u.id = a."userId"
  WHERE w.id::text ILIKE ${prefix + '%'}
  LIMIT 5
`

if (matches.length === 0) {
  console.error(`Nenhum saque encontrado com prefixo "${prefix}"`)
  process.exit(1)
}
if (matches.length > 1) {
  console.error(`Ambiguo: ${matches.length} saques encontrados:`)
  for (const m of matches) console.error(` - ${m.id}  ${m.status}  R$ ${m.amount}  ${m.userEmail}`)
  process.exit(1)
}

const wd = matches[0]
console.log(`Encontrado: ${wd.id}`)
console.log(`  User:    ${wd.userName} <${wd.userEmail}>`)
console.log(`  Valor:   R$ ${wd.amount}`)
console.log(`  Status:  ${wd.status}`)
console.log(`  Data:    ${wd.createdAt.toISOString()}`)

if (wd.status === 'COMPLETED') {
  console.log('Ja esta COMPLETED — nada a fazer.')
  process.exit(0)
}

const updated = await prisma.$executeRaw`
  UPDATE withdrawals
  SET status        = 'COMPLETED'::"WithdrawalStatus",
      "processedAt" = NOW(),
      "updatedAt"   = NOW(),
      notes         = CASE
                        WHEN notes IS NULL THEN 'Confirmado manualmente (sem mexer no saldo)'
                        ELSE notes || ' · Confirmado manualmente (sem mexer no saldo)'
                      END
  WHERE id = ${wd.id}
`
console.log(`\nOK — ${updated} linha atualizada. Status agora: COMPLETED`)
await prisma.$disconnect()
