/**
 * Zera saldo REAL e bônus de contas há mais de N dias sem acessar.
 *
 * Decisão do fundador (2026-09-20). Depósitos, operações, saques e o
 * cadastro ficam INTACTOS — só o saldo vai a zero, e com rastro:
 *   • lançamento ADJUSTMENT no extrato de cada conta, com o motivo
 *   • backup JSON com o valor anterior de cada conta (pra reverter)
 *   • rollover zerado junto (senão o usuário fica preso a um requisito
 *     de um bônus que não existe mais) e bonus_grants ACTIVE → CANCELLED
 *
 * Critério de inatividade: último login em login_history, ou a data do
 * cadastro pra quem nunca voltou (o cadastro loga direto, sem passar
 * pelo /login). Exclui fake, excluída e admin.
 *
 * PULA quem tem operação aberta ou saque PENDING/APPROVED — zerar no
 * meio disso corrompe dinheiro em trânsito.
 *
 * USO:
 *   node --import tsx scripts/zerar-saldos-inativos.ts             → simula
 *   node --import tsx scripts/zerar-saldos-inativos.ts --aplicar   → grava
 *   opcional: --dias=60  (padrão 30)
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/prisma.js'

const APLICAR = process.argv.includes('--aplicar')
const DIAS    = Number(process.argv.find((a) => a.startsWith('--dias='))?.split('=')[1] ?? 30)
const MOTIVO  = `Saldo zerado por inatividade (+${DIAS} dias sem acesso)`
const fmt     = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

interface Alvo {
  userId: string; email: string; accountId: string
  saldo: number; bonus: number; rolloverRequired: number; rolloverProgress: number
  ultimoAcesso: Date; opsAbertas: number; saquesPendentes: number
}

;(async () => {
  const alvos = await prisma.$queryRaw<Alvo[]>`
    SELECT u.id AS "userId", u.email, a.id AS "accountId",
           a.balance::float8 AS saldo, a."bonusBalance"::float8 AS bonus,
           a."rolloverRequired"::float8 AS "rolloverRequired",
           a."rolloverProgress"::float8 AS "rolloverProgress",
           GREATEST(u."createdAt", COALESCE(lh.ultimo, u."createdAt")) AS "ultimoAcesso",
           (SELECT COUNT(*)::int FROM operations o WHERE o."accountId" = a.id AND o.status = 'OPEN') AS "opsAbertas",
           (SELECT COUNT(*)::int FROM withdrawals w WHERE w."accountId" = a.id AND w.status IN ('PENDING','APPROVED')) AS "saquesPendentes"
    FROM users u
    JOIN accounts a ON a."userId" = u.id AND a.type = 'REAL'
    LEFT JOIN LATERAL (SELECT MAX("lastSeenAt") AS ultimo FROM login_history WHERE "userId" = u.id) lh ON true
    WHERE (a.balance > 0 OR a."bonusBalance" > 0)
      AND u.role = 'USER' AND NOT u."isFake" AND u."deletedAt" IS NULL
      AND GREATEST(u."createdAt", COALESCE(lh.ultimo, u."createdAt")) < NOW() - (${DIAS} || ' days')::interval
    ORDER BY (a.balance + a."bonusBalance") DESC
  `
  const pulados  = alvos.filter((a) => a.opsAbertas > 0 || a.saquesPendentes > 0)
  const zerar    = alvos.filter((a) => a.opsAbertas === 0 && a.saquesPendentes === 0)
  const somaReal = zerar.reduce((s, a) => s + a.saldo, 0)
  const somaBon  = zerar.reduce((s, a) => s + a.bonus, 0)

  console.log(`Critério: +${DIAS} dias sem acesso, com saldo real ou bônus, sem fake/excluída/admin`)
  console.log(`Encontradas: ${alvos.length} contas`)
  console.log(`  → zerar:   ${zerar.length} contas — saldo real ${fmt(somaReal)} | bônus ${fmt(somaBon)}`)
  console.log(`  → puladas: ${pulados.length} (operação aberta ou saque em andamento)`)
  if (pulados.length) console.table(pulados.map((p) => ({ email: p.email, saldo: fmt(p.saldo), bonus: fmt(p.bonus), ops: p.opsAbertas, saques: p.saquesPendentes })))

  console.log('\nMaiores 10 que serão zeradas:')
  console.table(zerar.slice(0, 10).map((a) => ({
    email: a.email.replace(/^(.{3}).*(@.*)$/, '$1***$2'),
    saldo_real: fmt(a.saldo), bonus: fmt(a.bonus),
    ultimo_acesso: new Date(a.ultimoAcesso).toLocaleDateString('pt-BR'),
  })))

  if (!APLICAR) {
    console.log('\n🟡 SIMULAÇÃO — nada foi gravado. Para aplicar: --aplicar')
    await prisma.$disconnect(); return
  }

  // Backup ANTES de tocar em qualquer coisa. Se o script cair no meio,
  // o que já foi zerado está aqui pra reverter.
  mkdirSync('scripts/backups', { recursive: true })
  const stamp   = new Date().toISOString().replace(/[:.]/g, '-')
  const arquivo = `scripts/backups/zerar-inativos-${stamp}.json`
  writeFileSync(arquivo, JSON.stringify({ criadoEm: new Date().toISOString(), dias: DIAS, motivo: MOTIVO, contas: zerar }, null, 2))
  console.log(`\n💾 Backup salvo em ${arquivo} — GUARDE este arquivo.`)

  let ok = 0
  for (const a of zerar) {
    await prisma.$transaction(async (tx) => {
      // Re-lê dentro da transação: se o usuário voltou e operou entre a
      // simulação e agora, o saldo pode ter mudado — zera o que está lá
      // e registra o valor real, não o da listagem.
      const [atual] = await tx.$queryRaw<Array<{ saldo: number; bonus: number }>>`
        SELECT balance::float8 AS saldo, "bonusBalance"::float8 AS bonus
        FROM accounts WHERE id = ${a.accountId} FOR UPDATE`
      await tx.$executeRaw`
        UPDATE accounts
           SET balance = 0, "bonusBalance" = 0,
               "rolloverRequired" = 0, "rolloverProgress" = 0,
               "updatedAt" = NOW()
         WHERE id = ${a.accountId}`
      if (atual.saldo !== 0) {
        await tx.$executeRaw`
          INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
          VALUES (${randomUUID()}, ${a.accountId}, 'ADJUSTMENT'::"TransactionType",
                  ${-atual.saldo}, ${MOTIVO}, NOW())`
      }
      if (atual.bonus !== 0) {
        await tx.$executeRaw`
          INSERT INTO transactions (id, "accountId", type, amount, description, "createdAt")
          VALUES (${randomUUID()}, ${a.accountId}, 'ADJUSTMENT'::"TransactionType",
                  ${-atual.bonus}, ${MOTIVO + ' — bônus'}, NOW())`
      }
      await tx.$executeRaw`
        UPDATE bonus_grants SET status = 'CANCELLED', "cancelledAt" = NOW()
        WHERE "userId" = ${a.userId} AND status IN ('PENDING','ACTIVE')`
    // maxWait/timeout: o padrão (2s/5s) estourou com o pooler remoto na
    // primeira execução, depois de 40 contas. Folga generosa — cada conta
    // é rápida, o gargalo é só abrir a conexão.
    }, { maxWait: 20_000, timeout: 30_000 })
    ok++
    if (ok % 50 === 0) console.log(`  ${ok}/${zerar.length}…`)
  }

  const [conf] = await prisma.$queryRaw<Array<{ restantes: number }>>`
    SELECT COUNT(*)::int AS restantes FROM accounts
    WHERE id IN (${Prisma.join(zerar.map((z) => z.accountId))})
      AND (balance > 0 OR "bonusBalance" > 0)`
  console.log(`\n✅ ${ok} contas zeradas. Backup: ${arquivo}`)
  console.log(conf.restantes === 0
    ? '   Conferência: nenhuma das contas ficou com saldo.'
    : `   ⚠️ Conferência: ${conf.restantes} conta(s) ainda com saldo — investigar.`)
  await prisma.$disconnect()
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
