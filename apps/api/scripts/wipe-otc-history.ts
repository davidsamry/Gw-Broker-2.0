// Wipe the OTC engine history tables from the local machine.
//
// What it does:
//   • TRUNCATE otc_candles   — all stored candle history
//   • (optional) TRUNCATE otc_ticks         — raw tick log
//   • (optional) TRUNCATE otc_engine_snapshot — last-known engine state
//
// Connects to whatever DATABASE_URL is in your .env (the same one the
// API uses) — runs from your local terminal, no Supabase UI needed.
//
// USAGE:
//   cd apps/api
//   npx tsx scripts/wipe-otc-history.ts              # candles only
//   npx tsx scripts/wipe-otc-history.ts --full       # candles + ticks + snapshot
//
// IMPORTANT: After running, restart the API container in EasyPanel
// (or restart `npm run dev` locally) so the engine's in-memory
// candleCache is cleared. Without a restart the API keeps serving
// the old candles from memory even though the DB is empty.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const full = process.argv.includes('--full')

async function main() {
  const prisma = new PrismaClient()
  try {
    const candleCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM otc_candles
    `
    console.log(`otc_candles current rows: ${candleCount[0].count}`)
    await prisma.$executeRawUnsafe('TRUNCATE TABLE otc_candles RESTART IDENTITY')
    console.log('  → truncated otc_candles')

    if (full) {
      const tickCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM otc_ticks
      `
      console.log(`otc_ticks   current rows: ${tickCount[0].count}`)
      await prisma.$executeRawUnsafe('TRUNCATE TABLE otc_ticks RESTART IDENTITY')
      console.log('  → truncated otc_ticks')

      await prisma.$executeRawUnsafe('TRUNCATE TABLE otc_engine_snapshot')
      console.log('  → truncated otc_engine_snapshot')
    }

    console.log('')
    console.log('Done. NEXT STEP: restart the API so the engine clears its')
    console.log('in-memory candleCache. After restart the bootstrap will')
    console.log('regenerate ~3000 candles per (asset, tf) in ~15s using the')
    console.log('current volatilityBase / asymmetric-wicks behavior.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
