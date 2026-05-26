import type { FastifyInstance } from 'fastify'
import {
  binanceCandlesQuerySchema,
  binanceTickerQuerySchema,
  marketAssetsQuerySchema,
} from './schema.js'
import {
  getBinanceCandles,
  getBinanceTicker,
  listBinanceAssets,
  listInternalAssets,
  listDisabledAssetIds,
} from './service.js'

export async function marketRoutes(app: FastifyInstance) {
  app.get('/assets', async (req, reply) => {
    const parsed = marketAssetsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const { source } = parsed.data
    const [binanceAssets, internalAssets] = await Promise.all([
      source && source !== 'BINANCE' ? Promise.resolve([]) : listBinanceAssets(),
      source && source !== 'INTERNAL' ? Promise.resolve([]) : Promise.resolve(listInternalAssets()),
    ])

    return reply.send({ assets: [...internalAssets, ...binanceAssets] })
  })

  // Public list of disabled asset IDs so the frontend can filter OTC
  // entries out of the selector. Binance entries are already filtered
  // server-side inside listBinanceAssets, but OTC entries live in
  // mockData.ts on the frontend.
  app.get('/disabled-asset-ids', async (_req, reply) => {
    const ids = await listDisabledAssetIds()
    return reply.send({ ids })
  })

  app.get('/binance/ticker', async (req, reply) => {
    const parsed = binanceTickerQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const ticker = await getBinanceTicker(parsed.data.symbol)
    return reply.send({ ticker })
  })

  app.get('/binance/candles', async (req, reply) => {
    const parsed = binanceCandlesQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const candles = await getBinanceCandles(parsed.data.symbol, parsed.data.interval, parsed.data.limit)
    return reply.send({ candles })
  })
}
