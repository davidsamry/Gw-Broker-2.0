import 'dotenv/config'
import { buildApp } from './app.js'
import { startExpirationWorker, stopExpirationWorker } from './operations/worker.js'
import { startOtcV2Worker, stopOtcV2Worker } from './otc/v2/worker.js'
import { refreshSettingsCache } from './settings/service.js'
import { startLiquidityGc, stopLiquidityGc } from './operations/liquidityManipulation.js'
import { startFakeWithdrawalWorker, stopFakeWithdrawalWorker } from './withdrawals/fakeWorker.js'

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

// ── Guard anti-poluição (2026-06-11) ──────────────────────────────────────
// Os "background workers" (engine OTC, resolução de operações, auto-aprovação
// de saque fake) ESCREVEM no banco. Se uma API LOCAL apontando pro banco de
// PRODUÇÃO os ligar, passa a existir uma SEGUNDA engine de preço gravando
// ticks no mesmo otc_ticks → preço incoerente → "vela verde mas marcou loss"
// pros usuários reais. Aconteceu de verdade.
//
// Regra:
//   - Em produção (NODE_ENV=production) os workers SEMPRE rodam — a flag de
//     desligar é IGNORADA, pra um DISABLE_BACKGROUND_WORKERS setado por
//     engano nunca derrubar a engine real.
//   - Fora de produção, setar DISABLE_BACKGROUND_WORKERS=true no .env local
//     desliga os workers → a API local serve UI/login/leitura sem virar uma
//     segunda engine. A engine de produção continua sendo a única fonte.
const IS_PROD = process.env.NODE_ENV === 'production'
const WORKERS_ENABLED = IS_PROD || process.env.DISABLE_BACKGROUND_WORKERS !== 'true'
// Host do banco — só pra deixar gritante no log qual DB a API está usando.
const dbHost = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').host || '?' } catch { return '?' }
})()

const app = await buildApp()

try {
  await app.listen({ port, host })
  app.log.info(`API listening on http://${host}:${port}`)
  // Hydrate the platform-settings cache so the first deposit/withdrawal/
  // operation request after boot already sees the DB values instead of
  // the hardcoded defaults baked into the service module.
  await refreshSettingsCache()

  if (!WORKERS_ENABLED) {
    app.log.warn(
      `⚠️  BACKGROUND WORKERS DESLIGADOS (DISABLE_BACKGROUND_WORKERS=true, NODE_ENV!=production). ` +
      `DB=${dbHost}. Engine OTC, resolução de operações e auto-saque NÃO vão rodar nesta instância — ` +
      `evita poluir o banco com uma segunda engine. Pra rodar a engine local, use um banco LOCAL e remova a flag.`,
    )
  } else {
    app.log.info(`Background workers ENABLED (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, DB=${dbHost})`)
    startExpirationWorker()
    app.log.info('Expiration worker started (polling every 1s)')
    // Auto-aprovar saques de contas fake (User.isFake=true) apos 1min.
    // Saques aparecem so' no painel do user — admin nao ve' (filtrado em
    // listAdminWithdrawals). E' visual interno, sem email.
    startFakeWithdrawalWorker()
    app.log.info('Fake withdrawal worker started (polling every 10s, auto-approve >60s)')
    // OTC v2 — the only OTC engine now (v1 retired in Etapa 8). Boots
    // in background (bootstrap of 3000 historical candles per asset/tf
    // can take ~10-30s on first deploy), doesn't block the API listen.
    void startOtcV2Worker().then(() => app.log.info('OTC v2 engine started'))
  }

  // Liquidity-mode in-memory signal GC — sweeps orphaned signals every
  // 5 min. In-memory only (no DB writes), so safe to run always.
  startLiquidityGc()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// Mirror the start sequence on shutdown — stop GC alongside the other
// timers so the process exits cleanly after a SIGTERM.
const shutdown = async (signal: string) => {
  stopLiquidityGc()
  app.log.info(`Received ${signal}, shutting down...`)
  try {
    stopExpirationWorker()
    stopFakeWithdrawalWorker()
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
