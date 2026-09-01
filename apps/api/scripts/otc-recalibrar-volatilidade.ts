/**
 * Recalibra o volatilityBase dos ativos OTC para um movimento "equilibrado".
 *
 * CONTEXTO: medido em producao, o BTC OTC tinha amplitude media de 4,29% por
 * vela de 1min contra 0,059% do BTC real na Binance — 73x mais volatil. Isso
 * fazia o preco viver colado nas barreiras do motor (+-20% do seed), gerando
 * o padrao ondulante repetitivo que nao parece mercado de verdade.
 *
 * ALVO: ~0,4% de amplitude por vela de 1min (~7x o mercado real). Realista o
 * bastante para o grafico parecer natural, e movimentado o bastante para
 * operacoes de 30s ainda terem resultado claro (o real, a 0,06%, empataria
 * quase sempre).
 *
 * METODO: fator UNICO aplicado a todos, preservando as diferencas relativas
 * entre ativos — DOGE continua mais volatil que ouro, como no mundo real.
 * Normalizar cada um para o mesmo alvo apagaria essa personalidade.
 *
 * USO:
 *   node --import tsx scripts/otc-recalibrar-volatilidade.ts            → simula
 *   node --import tsx scripts/otc-recalibrar-volatilidade.ts --aplicar  → grava
 *
 * IMPORTANTE: o motor le a config no BOOT (runtime/boot.ts -> assetStates).
 * A mudanca so tem efeito depois de reiniciar a API.
 */
import { prisma } from '../src/prisma.js'

// Fator fixo — TEM de bater com DIRECTIONAL_SCALE em
// src/otc/v2/engine/pricing.ts (1/31). O motor escala drift, reversao
// e force-reverse pelo mesmo fator; se os dois divergirem, a proporcao
// drift:ruido sai do lugar e o grafico deixa de parecer natural.
const FATOR    = 31
const APLICAR  = process.argv.includes('--aplicar')

;(async () => {
  // Amplitude REAL medida das ultimas 4h por ativo
  const medido = await prisma.$queryRaw<Array<any>>`
    SELECT c."assetId",
           AVG((c."highPrice"-c."lowPrice")/NULLIF(c."openPrice",0)*100)::float8 AS amp,
           COUNT(*)::int AS velas
    FROM otc_candles c
    WHERE c.timeframe = 60 AND c."openTime" > NOW() - INTERVAL '4 hours'
    GROUP BY 1 HAVING COUNT(*) > 30`
  const ampPorAtivo = new Map(medido.map((m) => [m.assetId, m.amp]))

  const ativos = await prisma.$queryRaw<Array<any>>`
    SELECT id, "volatilityBase"::float8 AS vol, "seedPrice"::float8 AS seed
    FROM otc_assets ORDER BY id`

  const comAmp = ativos.filter((a) => ampPorAtivo.has(a.id))
  const ampMedia = comAmp.reduce((s, a) => s + ampPorAtivo.get(a.id)!, 0) / comAmp.length

  console.log(`Amplitude média atual: ${ampMedia.toFixed(2)}% por vela de 1min`)
  console.log(`Dividindo por ${FATOR}×  →  alvo ${(ampMedia / FATOR).toFixed(2)}% por vela
`)

  const linhas = ativos.map((a) => {
    const ampAtual = ampPorAtivo.get(a.id)
    const novo = Number((a.vol / FATOR).toPrecision(3))
    return {
      ativo: a.id,
      amp_atual_pct: ampAtual ? Number(ampAtual.toFixed(2)) : null,
      amp_prevista_pct: ampAtual ? Number((ampAtual / FATOR).toFixed(3)) : null,
      vol_atual: a.vol,
      vol_novo: novo,
    }
  })
  console.table(linhas)
  console.log(`(${linhas.length} ativos no total)\n`)

  if (!APLICAR) {
    console.log('🟡 SIMULAÇÃO — nada foi gravado.')
    console.log('   Para aplicar: node --import tsx scripts/otc-recalibrar-volatilidade.ts --aplicar')
    console.log('\n   Valores ATUAIS (guarde para reverter se precisar):')
    console.log('   ' + ativos.map((a) => `${a.id}=${a.vol}`).join(' '))
    await prisma.$disconnect(); return
  }

  for (const l of linhas) {
    await prisma.$executeRaw`
      UPDATE otc_assets SET "volatilityBase" = ${l.vol_novo} WHERE id = ${l.ativo}`
  }
  const conf = await prisma.$queryRaw<Array<any>>`
    SELECT ROUND(AVG("volatilityBase")::numeric,6) AS media,
           ROUND(MIN("volatilityBase")::numeric,6) AS minimo,
           ROUND(MAX("volatilityBase")::numeric,6) AS maximo FROM otc_assets`
  console.log(`✅ ${linhas.length} ativos atualizados.`)
  console.table(conf)
  console.log('\n⚠️  O motor lê a config no BOOT — reinicie a API para valer.')
  await prisma.$disconnect()
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
