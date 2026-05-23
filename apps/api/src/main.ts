import 'dotenv/config'
import { buildApp } from './app.js'
import { startExpirationWorker, stopExpirationWorker } from './operations/worker.js'

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

const app = await buildApp()

try {
  await app.listen({ port, host })
  app.log.info(`API listening on http://${host}:${port}`)
  startExpirationWorker()
  app.log.info('Expiration worker started (polling every 1s)')
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`)
  try {
    stopExpirationWorker()
    await app.close()
    process.exit(0)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
