import { prisma } from '../../prisma.js'

// Variação de 24h por ativo OTC, calculada dos candles de 5min (tf=300,
// retenção 30 dias, ~50h de histórico no bootstrap). Usada no seletor de
// pares ("Mudança 24h") — antes mostrava +0.00% fixo porque o catálogo
// OTC não tinha fonte de variação.
//
// Usamos tf=300 (não tf=60) porque o bootstrap só gera ~17h de candles
// de 1min — não chega a 24h atrás. tf=300 cobre ~50h, então o candle de
// "24h atrás" existe. Fallback pro candle mais antigo disponível caso o
// ativo tenha < 24h de dados (engine recém-resetada) → nunca volta 0 por
// falta de referência.
//
// current = close do candle tf=300 mais recente
// past    = close do candle tf=300 <= (agora - 24h), ou o mais antigo
// change% = (current - past) / past * 100
//
// Cache de 60s: o seletor abre com frequência mas a variação 24h muda
// devagar. Query batched (DISTINCT ON) cobre todos os ativos. Lê do
// banco → funciona mesmo numa instância com os workers desligados.

let cache: { at: number; data: Record<string, number> } | null = null
const TTL_MS = 60_000

export async function getOtcChanges24h(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data

  const rows = await prisma.$queryRaw<Array<{ assetId: string; cur: number; old: number | null }>>`
    WITH cur AS (
      SELECT DISTINCT ON ("assetId") "assetId", "closePrice"::float8 AS c
      FROM otc_candles
      WHERE timeframe = 300
      ORDER BY "assetId", "openTime" DESC
    ),
    ref AS (
      SELECT DISTINCT ON ("assetId") "assetId", "closePrice"::float8 AS c
      FROM otc_candles
      WHERE timeframe = 300 AND "openTime" <= NOW() - INTERVAL '24 hours'
      ORDER BY "assetId", "openTime" DESC
    ),
    oldest AS (
      SELECT DISTINCT ON ("assetId") "assetId", "closePrice"::float8 AS c
      FROM otc_candles
      WHERE timeframe = 300
      ORDER BY "assetId", "openTime" ASC
    )
    SELECT cur."assetId" AS "assetId",
           cur.c                        AS cur,
           COALESCE(ref.c, oldest.c)    AS old
    FROM cur
    LEFT JOIN ref    USING ("assetId")
    LEFT JOIN oldest USING ("assetId")
  `

  const data: Record<string, number> = {}
  for (const r of rows) {
    const curP = Number(r.cur)
    const oldP = r.old == null ? null : Number(r.old)
    data[r.assetId] = oldP && oldP > 0 ? ((curP - oldP) / oldP) * 100 : 0
  }

  cache = { at: Date.now(), data }
  return data
}
