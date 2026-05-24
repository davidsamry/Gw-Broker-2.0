import 'dotenv/config'
import { buildApp } from './app.js'
import { startExpirationWorker, stopExpirationWorker } from './operations/worker.js'
import { startOtcWorker, stopOtcWorker } from './otc/worker.js'
import { startOtcV2Worker, stopOtcV2Worker } from './otc/v2/worker.js'

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

const app = await buildApp()

try {
  await app.listen({ port, host })
  app.log.info(`API listening on http://${host}:${port}`)
  startExpirationWorker()
  app.log.info('Expiration worker started (polling every 1s)')
  startOtcWorker()
  app.log.info('OTC v1 (legacy) price worker started')
  // OTC v2 — the new engine. Boots in background (bootstrap of 3000
  // historical candles per asset/tf can take ~10-30s on first deploy),
  // doesn't block the API listen.
  void startOtcV2Worker().then(() => app.log.info('OTC v2 engine started'))
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`)
  try {
    stopExpirationWorker()
    stopOtcWorker()
    stopOtcV2Worker()
    await app.close()
    process.exit(0)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
