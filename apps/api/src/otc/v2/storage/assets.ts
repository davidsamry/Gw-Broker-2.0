// Fase 4 — config-table I/O (otc_assets). Reads asset configs at boot
// and self-heals the table if it ever empties out (e.g., migration
// never ran for some reason).

import { prisma } from '../../../prisma.js'
import type { OtcAssetConfig } from '../types.js'

export async function loadAssetConfigs(): Promise<OtcAssetConfig[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; seedPrice: string; volatilityBase: number;
    speedMultiplier: number; enabled: boolean; paused: boolean
  }>>`
    SELECT id, "seedPrice"::text AS "seedPrice", "volatilityBase",
           "speedMultiplier", enabled, paused
    FROM otc_assets
    ORDER BY "displayOrder" ASC, symbol ASC
  `
  return rows.map(r => ({
    id:              r.id,
    seedPrice:       Number(r.seedPrice),
    volatilityBase:  r.volatilityBase,
    speedMultiplier: r.speedMultiplier,
    enabled:         r.enabled,
    paused:          r.paused,
  }))
}

// Inserts the canonical 5 launch OTC assets if otc_assets is empty.
// Mirrors migration 20260524155500_otc_v2_seed but runs inline at
// engine boot so we don't depend on `prisma migrate deploy` succeeding
// in production. Volatility values match the calibrated post-deploy
// settings (migration 20260524182500), not the original wild defaults.
export async function selfHealSeed(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO otc_assets
      (id, symbol, name, category, enabled, paused, payout,
       "seedPrice", "volatilityBase", "speedMultiplier",
       "displayOrder", "createdAt", "updatedAt")
    VALUES
      ('eur-usd-otc', 'EUR/USD', 'EUR/USD (OTC)', 'FOREX'::"OtcCategory",       TRUE, FALSE, 85,     1.08500, 0.00020, 1.0, 1, NOW(), NOW()),
      ('gbp-jpy-otc', 'GBP/JPY', 'GBP/JPY (OTC)', 'FOREX'::"OtcCategory",       TRUE, FALSE, 87,   198.50000, 0.00030, 1.0, 2, NOW(), NOW()),
      ('btc-usd-otc', 'BTC/USD', 'BTC/USD (OTC)', 'CRYPTO'::"OtcCategory",      TRUE, FALSE, 82, 68000.00000, 0.00080, 1.0, 3, NOW(), NOW()),
      ('gold-otc',    'GOLD',    'GOLD (OTC)',    'COMMODITIES'::"OtcCategory", TRUE, FALSE, 80,  2350.00000, 0.00025, 1.0, 4, NOW(), NOW()),
      ('nasdaq-otc',  'NASDAQ',  'NASDAQ (OTC)',  'INDICES'::"OtcCategory",     TRUE, FALSE, 78, 18450.00000, 0.00022, 1.0, 5, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO otc_market_state
      ("assetId", "currentRegime", "regimeStartedAt", "regimeDurationS", "currentDrift", "currentVol", "trendBias", "updatedAt")
    SELECT id, 'LATERAL'::"OtcRegime", NOW(), 60, 0, "volatilityBase", 0, NOW()
    FROM otc_assets
    WHERE id IN ('eur-usd-otc','gbp-jpy-otc','btc-usd-otc','gold-otc','nasdaq-otc')
    ON CONFLICT ("assetId") DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO otc_liquidity_state
      ("assetId", spread, "buyPressure", "sellPressure", volume, depth, speed, "updatedAt")
    SELECT id, 0.0001, 0.5, 0.5, 1.0, 1.0, 1.0, NOW()
    FROM otc_assets
    WHERE id IN ('eur-usd-otc','gbp-jpy-otc','btc-usd-otc','gold-otc','nasdaq-otc')
    ON CONFLICT ("assetId") DO NOTHING
  `
}
