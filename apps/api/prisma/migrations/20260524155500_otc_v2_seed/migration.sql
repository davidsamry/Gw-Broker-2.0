-- Seed the 5 launch OTC assets for the new pricing engine (OTC v2).
-- Idempotent: ON CONFLICT DO NOTHING means re-running on a fresh clone
-- or accidental re-execution won't duplicate rows.
--
-- Each asset also gets a default OtcMarketState (LATERAL regime) and
-- OtcLiquidityState row so the engine doesn't have to bootstrap state
-- on first tick. Defaults match the model defaults; admin can tune later.
--
-- Volatility values are tuned per asset class:
--   • FOREX majors (EUR/USD): 0.0003 (~3bp/tick) — calm
--   • FOREX crosses (GBP/JPY): 0.0006 (~6bp/tick) — more volatile
--   • CRYPTO (BTC/USD): 0.0010 (~10bp/tick) — high
--   • COMMODITIES (GOLD): 0.0005 (~5bp/tick) — medium
--   • INDICES (NASDAQ): 0.0004 (~4bp/tick) — medium-low

INSERT INTO otc_assets (id, symbol, name, category, enabled, paused, payout, "seedPrice", "volatilityBase", "speedMultiplier", "displayOrder", "createdAt", "updatedAt") VALUES
  ('eur-usd-otc',  'EUR/USD',  'EUR/USD (OTC)',  'FOREX'::"OtcCategory",       TRUE, FALSE, 85,     1.08500,  0.0003, 1.0, 1, NOW(), NOW()),
  ('gbp-jpy-otc',  'GBP/JPY',  'GBP/JPY (OTC)',  'FOREX'::"OtcCategory",       TRUE, FALSE, 87,   198.50000,  0.0006, 1.0, 2, NOW(), NOW()),
  ('btc-usd-otc',  'BTC/USD',  'BTC/USD (OTC)',  'CRYPTO'::"OtcCategory",      TRUE, FALSE, 82, 68000.00000,  0.0010, 1.0, 3, NOW(), NOW()),
  ('gold-otc',     'GOLD',     'GOLD (OTC)',     'COMMODITIES'::"OtcCategory", TRUE, FALSE, 80,  2350.00000,  0.0005, 1.0, 4, NOW(), NOW()),
  ('nasdaq-otc',   'NASDAQ',   'NASDAQ (OTC)',   'INDICES'::"OtcCategory",     TRUE, FALSE, 78, 18450.00000,  0.0004, 1.0, 5, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Bootstrap market state — every asset starts in LATERAL regime so the
-- engine begins with a calm baseline. Regime FSM (Etapa 2) takes over from
-- here and starts transitioning naturally.
INSERT INTO otc_market_state ("assetId", "currentRegime", "regimeStartedAt", "regimeDurationS", "currentDrift", "currentVol", "trendBias", "updatedAt")
SELECT id, 'LATERAL'::"OtcRegime", NOW(), 60, 0, "volatilityBase", 0, NOW()
FROM otc_assets
WHERE id IN ('eur-usd-otc','gbp-jpy-otc','btc-usd-otc','gold-otc','nasdaq-otc')
ON CONFLICT ("assetId") DO NOTHING;

-- Bootstrap liquidity state — neutral balance, average volume.
INSERT INTO otc_liquidity_state ("assetId", spread, "buyPressure", "sellPressure", volume, depth, speed, "updatedAt")
SELECT id, 0.0001, 0.5, 0.5, 1.0, 1.0, 1.0, NOW()
FROM otc_assets
WHERE id IN ('eur-usd-otc','gbp-jpy-otc','btc-usd-otc','gold-otc','nasdaq-otc')
ON CONFLICT ("assetId") DO NOTHING;
