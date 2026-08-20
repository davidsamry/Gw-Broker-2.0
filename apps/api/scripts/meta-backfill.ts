/**
 * Reenvia à Meta os eventos perdidos enquanto o Pixel esteve desligado.
 *
 * USO:
 *   node --import tsx scripts/meta-backfill.ts            → SIMULA (não envia)
 *   node --import tsx scripts/meta-backfill.ts --executar → ENVIA de verdade
 *
 * A Meta rejeita eventos com mais de 7 dias (e rejeita a REQUISIÇÃO INTEIRA
 * se um só estiver fora). O filtro da janela é aplicado evento a evento.
 */
import { prisma } from '../src/prisma.js'
import { backfillRegistration, backfillPurchase, dentroDaJanelaMeta, type ResultadoBackfill } from '../src/meta/service.js'

const EXECUTAR = process.argv.includes('--executar')
const PAUSA_MS = 250   // respeita o rate limit da Meta

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const cfg = (await prisma.$queryRaw<Array<any>>`SELECT enabled FROM meta_pixel_settings WHERE id='global'`)[0]
  console.log(`Pixel: ${cfg?.enabled ? 'LIGADO' : 'DESLIGADO'} | modo: ${EXECUTAR ? '🔴 ENVIO REAL' : '🟡 SIMULAÇÃO'}\n`)
  if (EXECUTAR && !cfg?.enabled) {
    console.log('Pixel desligado — nada seria enviado. Ligue em /admin/meta-pixel primeiro.')
    await prisma.$disconnect(); return
  }

  // ── Registros ────────────────────────────────────────────────────────
  const users = await prisma.$queryRaw<Array<any>>`
    SELECT u.id, u.email, u.name, u."lastName", u.phone, u.city, u.state, u.zip,
           u.country, u."createdAt"
    FROM users u
    WHERE u."createdAt" > NOW() - INTERVAL '7 days'
    ORDER BY u."createdAt" ASC`

  // ── Depósitos pagos ──────────────────────────────────────────────────
  const deps = await prisma.$queryRaw<Array<any>>`
    SELECT d.id AS "depositId", d.amount::float8 AS amount, d."paidAt",
           u.id, u.email, u.name, u."lastName", u.phone, u.city, u.state, u.zip, u.country
    FROM deposits d
    JOIN accounts a ON a.id = d."accountId"
    JOIN users    u ON u.id = a."userId"
    WHERE d.status = 'PAID' AND d."paidAt" > NOW() - INTERVAL '7 days'
    ORDER BY d."paidAt" ASC`

  console.log(`Candidatos: ${users.length} registros | ${deps.length} depósitos\n`)

  const contar = (arr: ResultadoBackfill[]) =>
    arr.reduce((a, r) => { a[r] = (a[r] ?? 0) + 1; return a }, {} as Record<string, number>)

  const perfil = (u: any) => ({
    id: u.id, email: u.email, phone: u.phone, firstName: u.name, lastName: u.lastName,
    city: u.city, state: u.state, zip: u.zip, country: u.country,
  })

  // ── REGISTROS ────────────────────────────────────────────────────────
  const rReg: ResultadoBackfill[] = []
  for (const [i, u] of users.entries()) {
    if (!dentroDaJanelaMeta(u.createdAt)) { rReg.push('fora-da-janela'); continue }
    if (!EXECUTAR) { rReg.push('enviado'); continue }
    rReg.push(await backfillRegistration(perfil(u), u.createdAt))
    if ((i + 1) % 25 === 0) console.log(`  registros: ${i + 1}/${users.length}`)
    await pausa(PAUSA_MS)
  }
  console.log('Registros →', contar(rReg))

  // ── DEPÓSITOS ────────────────────────────────────────────────────────
  const rDep: ResultadoBackfill[] = []
  let valorEnviado = 0
  for (const [i, d] of deps.entries()) {
    if (!dentroDaJanelaMeta(d.paidAt)) { rDep.push('fora-da-janela'); continue }
    if (!EXECUTAR) { rDep.push('enviado'); valorEnviado += d.amount; continue }
    const r = await backfillPurchase(perfil(d), { id: d.depositId, amount: d.amount }, d.paidAt)
    rDep.push(r)
    if (r === 'enviado') valorEnviado += d.amount
    if ((i + 1) % 20 === 0) console.log(`  depósitos: ${i + 1}/${deps.length}`)
    await pausa(PAUSA_MS)
  }
  console.log('Depósitos →', contar(rDep))
  console.log(`Valor total ${EXECUTAR ? 'enviado' : 'que seria enviado'}: R$ ${valorEnviado.toFixed(2)}`)

  if (!EXECUTAR) {
    console.log('\n🟡 SIMULAÇÃO — nada foi enviado.')
    console.log('   Para enviar de verdade: node --import tsx scripts/meta-backfill.ts --executar')
  } else {
    const log = (await prisma.$queryRaw<Array<any>>`
      SELECT success, COUNT(*)::int AS n FROM meta_events_log
      WHERE "createdAt" > NOW() - INTERVAL '30 minutes' GROUP BY 1`)
    console.log('\nRegistrado em meta_events_log (30min):'); console.table(log)
  }
  await prisma.$disconnect()
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
