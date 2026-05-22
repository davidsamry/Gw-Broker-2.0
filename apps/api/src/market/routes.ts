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
