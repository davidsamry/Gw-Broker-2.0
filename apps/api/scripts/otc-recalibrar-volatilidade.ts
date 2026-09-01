/**
 * Recalibra o volatilityBase dos ativos OTC.
 *
 * CONTEXTO: medido em producao, as velas OTC de 1min tinham 3,43% de
 * amplitude media contra 0,059% do BTC real na Binance — 58x. Com esse
 * tamanho de passo o preco vivia colado na barreira de +-20% do seed
 * (10 de 34 ativos estavam la), batendo e sendo empurrado de volta sem
 * parar: era dai que vinha o padrao ondulante de velas repetidas.
 *
 * ALVO: ~0,4% de amplitude por vela de 1min (~7x o mercado real).
 * Realista o bastante para o grafico parecer natural, e movimentado o
 * bastante para operacoes de 30s ainda terem resultado claro (o real,
 * a 0,06%, empataria quase sempre).
 *
 * FATOR: 3,43% / 0,4% = 8,6. Numero tirado DIRETO da medicao de
 * producao. Na primeira tentativa usei 31, vindo de uma simulacao
 * Monte Carlo que superestimava a amplitude em ~3,5x; o resultado em
 * producao foi 0,10% — 4x mais parado que o pedido. A producao escala
 * LINEARMENTE com o volatilityBase (3,43/31 = 0,111 ~= 0,10 medido),
 * entao regra de tres sobre dados reais e' o metodo confiavel aqui.
 * Nao confie em simulacao para calibrar isto.
 *
 * IDEMPOTENTE: parte dos valores ORIGINAIS abaixo, nao do que esta no
 * banco. Rodar duas vezes da o mesmo resultado.
 *
 * USO:
 *   node --import tsx scripts/otc-recalibrar-volatilidade.ts            → simula
 *   node --import tsx scripts/otc-recalibrar-volatilidade.ts --aplicar  → grava
 *
 * O motor le a config no BOOT (runtime/boot.ts -> assetStates). Na
 * pratica: rode o script e faca o deploy — os dois passam a valer
 * juntos no restart.
 */
import { prisma } from '../src/prisma.js'

// Fator unico, preservando as diferencas relativas entre ativos: DOGE
// continua mais volatil que ouro, como no mundo real. Normalizar cada
// um para o mesmo alvo apagaria essa personalidade.
//
// TEM de bater com DIRECTIONAL_SCALE em src/otc/v2/engine/pricing.ts
// (1/8.6). O motor escala drift, force-reverse e trendBias pelo mesmo
// fator; se os dois divergirem, a proporcao drift:ruido sai do lugar e
// os trends viram rampas retas.
const FATOR   = 8.6
const APLICAR = process.argv.includes('--aplicar')

// Valores de fabrica, antes de qualquer recalibracao. Fonte da verdade
// para o calculo — assim o script pode rodar quantas vezes for preciso
// sem dividir em cima do que ja foi dividido.
const ORIGINAIS: Record<string, number> = {
  'aapl-otc': 0.0006,     'ada-usd-otc': 0.0012,  'amzn-otc': 0.0006,
  'aud-usd-otc': 0.0004,  'bnb-usd-otc': 0.001,   'brent-otc': 0.0006,
  'btc-usd-otc': 0.00072, 'copper-otc': 0.0006,   'doge-usd-otc': 0.0015,
  'eth-usd-otc': 0.001,   'eur-aud-otc': 0.0004,  'eur-gbp-otc': 0.0004,
  'eur-usd-otc': 0.0005,  'gbp-jpy-otc': 0.00027, 'gold-otc': 0.0003,
  'googl-otc': 0.0006,    'link-usd-otc': 0.001,  'meta-otc': 0.0006,
  'msft-otc': 0.0006,     'nasdaq-otc': 0.00018,  'natgas-otc': 0.0008,
  'nvda-otc': 0.0007,     'nzd-usd-otc': 0.0004,  'oil-otc': 0.0006,
  'platinum-otc': 0.0005, 'silver-otc': 0.0006,   'sol-usd-otc': 0.0012,
  'tsla-otc': 0.0008,     'usd-brl-otc': 0.0005,  'usd-cad-otc': 0.0004,
  'usd-chf-otc': 0.0004,  'usd-jpy-otc': 0.0004,  'wheat-otc': 0.0005,
  'xrp-usd-otc': 0.0012,
}

;(async () => {
  const ativos = await prisma.$queryRaw<Array<{ id: string; vol: number }>>`
    SELECT id, "volatilityBase"::float8 AS vol FROM otc_assets ORDER BY id`

  const semOriginal = ativos.filter((a) => ORIGINAIS[a.id] == null)
  if (semOriginal.length > 0) {
    console.error('⚠️  Ativos sem valor original mapeado — adicione em ORIGINAIS antes de rodar:')
    console.error('   ' + semOriginal.map((a) => `${a.id} (hoje ${a.vol})`).join(', '))
    await prisma.$disconnect(); process.exit(1)
  }

  console.log(`Dividindo os valores de fábrica por ${FATOR}×  →  alvo ~0,40% de amplitude por vela\n`)

  const linhas = ativos.map((a) => ({
    ativo: a.id,
    vol_original: ORIGINAIS[a.id]!,
    vol_no_banco: a.vol,
    vol_novo: Number((ORIGINAIS[a.id]! / FATOR).toPrecision(3)),
  }))
  console.table(linhas)

  const mudam = linhas.filter((l) => l.vol_no_banco !== l.vol_novo).length
  console.log(`${linhas.length} ativos — ${mudam} mudam de valor\n`)

  if (!APLICAR) {
    console.log('🟡 SIMULAÇÃO — nada foi gravado.')
    console.log('   Para aplicar: node --import tsx scripts/otc-recalibrar-volatilidade.ts --aplicar')
    await prisma.$disconnect(); return
  }

  for (const l of linhas) {
    await prisma.$executeRaw`
      UPDATE otc_assets SET "volatilityBase" = ${l.vol_novo} WHERE id = ${l.ativo}`
  }
  const conf = await prisma.$queryRaw<Array<unknown>>`
    SELECT ROUND(AVG("volatilityBase")::numeric,7) AS media,
           ROUND(MIN("volatilityBase")::numeric,7) AS minimo,
           ROUND(MAX("volatilityBase")::numeric,7) AS maximo FROM otc_assets`
  console.log(`✅ ${linhas.length} ativos atualizados.`)
  console.table(conf)
  console.log('\n⚠️  O motor lê a config no BOOT — reinicie a API para valer.')
  await prisma.$disconnect()
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
