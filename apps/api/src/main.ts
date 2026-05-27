import 'dotenv/config'
import { buildApp } from './app.js'
import { startExpirationWorker, stopExpirationWorker } from './operations/worker.js'
import { startOtcV2Worker, stopOtcV2Worker } from './otc/v2/worker.js'
import { refreshSettingsCache } from './settings/service.js'

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

const app = await buildApp()

try {
  await app.listen({ port, host })
  app.log.info(`API listening on http://${host}:${port}`)
  // Hydrate the platform-settings cache so the first deposit/withdrawal/
  // operation request after boot already sees the DB values instead of
  // the hardcoded defaults baked into the service module.
  await refreshSettingsCache()
  startExpirationWorker()
  app.log.info('Expiration worker started (polling every 1s)')
  // OTC v2 — the only OTC engine now (v1 retired in Etapa 8). Boots
  // in background (bootstrap of 3000 historical candles per asset/tf
  // can take ~10-30s on first deploy), doesn't block the API listen.
  void startOtcV2Worker().then(() => app.log.info('OTC v2 engine started'))
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`)
  try {
    stopExpirationWorker()
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
