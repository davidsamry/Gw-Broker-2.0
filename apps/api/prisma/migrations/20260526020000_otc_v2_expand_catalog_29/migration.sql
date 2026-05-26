-- Expand OTC v2 catalog from 5 → 34 assets (29 new).
-- Each asset becomes a full-engine OTC v2 ticker: own snapshot/state/regime,
-- own SSE pool, own candle aggregation. Frontend selector + admin /ativos
-- both surface them (see mockData.ts update in the same PR + assets table
-- inserts below).
--
-- Volatility tiers per category (matches launch seed conventions):
--   FOREX:       0.0004 (4bp/tick) — calm currency pairs
--   CRYPTO:      0.0010 (10bp/tick) — high
--   COMMODITIES: 0.0005 (5bp/tick) — medium
--   INDICES:     0.0006 (6bp/tick) — medium-high (used here for stocks too)
--
-- ON CONFLICT DO NOTHING throughout — re-runnable.

INSERT INTO otc_assets (id, symbol, name, category, enabled, paused, payout, "seedPrice", "volatilityBase", "speedMultiplier", "displayOrder", "createdAt", "updatedAt") VALUES
  -- ── FOREX (8 new) ──────────────────────────────────────────────────────
  ('usd-jpy-otc',  'USD/JPY',  'USD/JPY (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 90,   155.20000, 0.0004, 1.0, 10, NOW(), NOW()),
  ('aud-usd-otc',  'AUD/USD',  'AUD/USD (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 89,     0.65000, 0.0004, 1.0, 11, NOW(), NOW()),
  ('usd-cad-otc',  'USD/CAD',  'USD/CAD (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 88,     1.38000, 0.0004, 1.0, 12, NOW(), NOW()),
  ('usd-chf-otc',  'USD/CHF',  'USD/CHF (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 87,     0.91000, 0.0004, 1.0, 13, NOW(), NOW()),
  ('eur-gbp-otc',  'EUR/GBP',  'EUR/GBP (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 86,     0.86000, 0.0004, 1.0, 14, NOW(), NOW()),
  ('nzd-usd-otc',  'NZD/USD',  'NZD/USD (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 85,     0.59000, 0.0004, 1.0, 15, NOW(), NOW()),
  ('usd-brl-otc',  'USD/BRL',  'USD/BRL (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 90,     5.50000, 0.0005, 1.0, 16, NOW(), NOW()),
  ('eur-aud-otc',  'EUR/AUD',  'EUR/AUD (OTC)',  'FOREX'::"OtcCategory", TRUE, FALSE, 85,     1.65000, 0.0004, 1.0, 17, NOW(), NOW()),

  -- ── CRYPTO (7 new) ─────────────────────────────────────────────────────
  ('eth-usd-otc',  'ETH/USD',  'ETH/USD (OTC)',  'CRYPTO'::"OtcCategory", TRUE, FALSE, 82,  3500.00000, 0.0010, 1.0, 20, NOW(), NOW()),
  ('sol-usd-otc',  'SOL/USD',  'SOL/USD (OTC)',  'CRYPTO'::"OtcCategory", TRUE, FALSE, 82,   170.00000, 0.0012, 1.0, 21, NOW(), NOW()),
  ('xrp-usd-otc',  'XRP/USD',  'XRP/USD (OTC)',  'CRYPTO'::"OtcCategory", TRUE, FALSE, 80,     0.51000, 0.0012, 1.0, 22, NOW(), NOW()),
  ('bnb-usd-otc',  'BNB/USD',  'BNB/USD (OTC)',  'CRYPTO'::"OtcCategory", TRUE, FALSE, 82,   610.00000, 0.0010, 1.0, 23, NOW(), NOW()),
  ('doge-usd-otc', 'DOGE/USD', 'DOGE/USD (OTC)', 'CRYPTO'::"OtcCategory", TRUE, FALSE, 80,     0.16000, 0.0015, 1.0, 24, NOW(), NOW()),
  ('ada-usd-otc',  'ADA/USD',  'ADA/USD (OTC)',  'CRYPTO'::"OtcCategory", TRUE, FALSE, 80,     0.45000, 0.0012, 1.0, 25, NOW(), NOW()),
  ('link-usd-otc', 'LINK/USD', 'LINK/USD (OTC)', 'CRYPTO'::"OtcCategory", TRUE, FALSE, 80,    14.30000, 0.0010, 1.0, 26, NOW(), NOW()),

  -- ── COMMODITIES (7 new) ────────────────────────────────────────────────
  ('silver-otc',   'SILVER',   'SILVER (OTC)',   'COMMODITIES'::"OtcCategory", TRUE, FALSE, 80,    28.50000, 0.0006, 1.0, 30, NOW(), NOW()),
  ('oil-otc',      'OIL',      'OIL (OTC)',      'COMMODITIES'::"OtcCategory", TRUE, FALSE, 80,    78.50000, 0.0006, 1.0, 31, NOW(), NOW()),
  ('brent-otc',    'BRENT',    'BRENT (OTC)',    'COMMODITIES'::"OtcCategory", TRUE, FALSE, 80,    82.30000, 0.0006, 1.0, 32, NOW(), NOW()),
  ('copper-otc',   'COPPER',   'COPPER (OTC)',   'COMMODITIES'::"OtcCategory", TRUE, FALSE, 78,     4.20000, 0.0006, 1.0, 33, NOW(), NOW()),
  ('platinum-otc', 'PLATINUM', 'PLATINUM (OTC)', 'COMMODITIES'::"OtcCategory", TRUE, FALSE, 78,   950.00000, 0.0005, 1.0, 34, NOW(), NOW()),
  ('natgas-otc',   'NATGAS',   'NATGAS (OTC)',   'COMMODITIES'::"OtcCategory", TRUE, FALSE, 78,     2.80000, 0.0008, 1.0, 35, NOW(), NOW()),
  ('wheat-otc',    'WHEAT',    'WHEAT (OTC)',    'COMMODITIES'::"OtcCategory", TRUE, FALSE, 78,   540.00000, 0.0005, 1.0, 36, NOW(), NOW()),

  -- ── INDICES (7 stocks treated as indices) ──────────────────────────────
  ('aapl-otc',  'AAPL',  'Apple (OTC)',        'INDICES'::"OtcCategory", TRUE, FALSE, 78,  215.00000, 0.0006, 1.0, 40, NOW(), NOW()),
  ('msft-otc',  'MSFT',  'Microsoft (OTC)',    'INDICES'::"OtcCategory", TRUE, FALSE, 78,  425.00000, 0.0006, 1.0, 41, NOW(), NOW()),
  ('googl-otc', 'GOOGL', 'Google (OTC)',       'INDICES'::"OtcCategory", TRUE, FALSE, 78,  170.00000, 0.0006, 1.0, 42, NOW(), NOW()),
  ('amzn-otc',  'AMZN',  'Amazon (OTC)',       'INDICES'::"OtcCategory", TRUE, FALSE, 78,  185.00000, 0.0006, 1.0, 43, NOW(), NOW()),
  ('tsla-otc',  'TSLA',  'Tesla (OTC)',        'INDICES'::"OtcCategory", TRUE, FALSE, 76,  220.00000, 0.0008, 1.0, 44, NOW(), NOW()),
  ('meta-otc',  'META',  'Meta (OTC)',         'INDICES'::"OtcCategory", TRUE, FALSE, 78,  510.00000, 0.0006, 1.0, 45, NOW(), NOW()),
  ('nvda-otc',  'NVDA',  'Nvidia (OTC)',       'INDICES'::"OtcCategory", TRUE, FALSE, 78,  130.00000, 0.0007, 1.0, 46, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Bootstrap market state for every new asset (start in LATERAL regime so
-- the FSM begins from a calm baseline; engine transitions from here).
INSERT INTO otc_market_state ("assetId", "currentRegime", "regimeStartedAt", "regimeDurationS", "currentDrift", "currentVol", "trendBias", "updatedAt")
SELECT id, 'LATERAL'::"OtcRegime", NOW(), 60, 0, "volatilityBase", 0, NOW()
FROM otc_assets
WHERE id IN (
  'usd-jpy-otc','aud-usd-otc','usd-cad-otc','usd-chf-otc','eur-gbp-otc','nzd-usd-otc','usd-brl-otc','eur-aud-otc',
  'eth-usd-otc','sol-usd-otc','xrp-usd-otc','bnb-usd-otc','doge-usd-otc','ada-usd-otc','link-usd-otc',
  'silver-otc','oil-otc','brent-otc','copper-otc','platinum-otc','natgas-otc','wheat-otc',
  'aapl-otc','msft-otc','googl-otc','amzn-otc','tsla-otc','meta-otc','nvda-otc'
)
ON CONFLICT ("assetId") DO NOTHING;

-- Bootstrap liquidity state — neutral baseline.
INSERT INTO otc_liquidity_state ("assetId", spread, "buyPressure", "sellPressure", volume, depth, speed, "updatedAt")
SELECT id, 0.0001, 0.5, 0.5, 1.0, 1.0, 1.0, NOW()
FROM otc_assets
WHERE id IN (
  'usd-jpy-otc','aud-usd-otc','usd-cad-otc','usd-chf-otc','eur-gbp-otc','nzd-usd-otc','usd-brl-otc','eur-aud-otc',
  'eth-usd-otc','sol-usd-otc','xrp-usd-otc','bnb-usd-otc','doge-usd-otc','ada-usd-otc','link-usd-otc',
  'silver-otc','oil-otc','brent-otc','copper-otc','platinum-otc','natgas-otc','wheat-otc',
  'aapl-otc','msft-otc','googl-otc','amzn-otc','tsla-otc','meta-otc','nvda-otc'
)
ON CONFLICT ("assetId") DO NOTHING;

-- Mirror into the admin `assets` table so /admin/ativos can enable/disable
-- + adjust payout per asset (same cross-reference pattern used by Binance
-- catalog → service.ts listBinanceAssets).
INSERT INTO assets (id, symbol, name, category, payout, enabled, code1, code2, "marketSymbol", "displayOrder", "createdAt", "updatedAt") VALUES
  -- FOREX
  ('usd-jpy-otc', 'USD/JPY (OTC)', 'USD/JPY OTC', 'OTC', 90, TRUE, 'us', 'jp', NULL, 200, NOW(), NOW()),
  ('aud-usd-otc', 'AUD/USD (OTC)', 'AUD/USD OTC', 'OTC', 89, TRUE, 'au', 'us', NULL, 201, NOW(), NOW()),
  ('usd-cad-otc', 'USD/CAD (OTC)', 'USD/CAD OTC', 'OTC', 88, TRUE, 'us', 'ca', NULL, 202, NOW(), NOW()),
  ('usd-chf-otc', 'USD/CHF (OTC)', 'USD/CHF OTC', 'OTC', 87, TRUE, 'us', 'ch', NULL, 203, NOW(), NOW()),
  ('eur-gbp-otc', 'EUR/GBP (OTC)', 'EUR/GBP OTC', 'OTC', 86, TRUE, 'eu', 'gb', NULL, 204, NOW(), NOW()),
  ('nzd-usd-otc', 'NZD/USD (OTC)', 'NZD/USD OTC', 'OTC', 85, TRUE, 'nz', 'us', NULL, 205, NOW(), NOW()),
  ('usd-brl-otc', 'USD/BRL (OTC)', 'USD/BRL OTC', 'OTC', 90, TRUE, 'us', 'br', NULL, 206, NOW(), NOW()),
  ('eur-aud-otc', 'EUR/AUD (OTC)', 'EUR/AUD OTC', 'OTC', 85, TRUE, 'eu', 'au', NULL, 207, NOW(), NOW()),
  -- CRYPTO
  ('eth-usd-otc',  'ETH/USD (OTC)',  'Ethereum OTC',  'OTC', 82, TRUE, 'crypto:eth',  'us', NULL, 210, NOW(), NOW()),
  ('sol-usd-otc',  'SOL/USD (OTC)',  'Solana OTC',    'OTC', 82, TRUE, 'crypto:sol',  'us', NULL, 211, NOW(), NOW()),
  ('xrp-usd-otc',  'XRP/USD (OTC)',  'Ripple OTC',    'OTC', 80, TRUE, 'crypto:xrp',  'us', NULL, 212, NOW(), NOW()),
  ('bnb-usd-otc',  'BNB/USD (OTC)',  'BNB OTC',       'OTC', 82, TRUE, 'crypto:bnb',  'us', NULL, 213, NOW(), NOW()),
  ('doge-usd-otc', 'DOGE/USD (OTC)', 'Dogecoin OTC',  'OTC', 80, TRUE, 'crypto:doge', 'us', NULL, 214, NOW(), NOW()),
  ('ada-usd-otc',  'ADA/USD (OTC)',  'Cardano OTC',   'OTC', 80, TRUE, 'crypto:ada',  'us', NULL, 215, NOW(), NOW()),
  ('link-usd-otc', 'LINK/USD (OTC)', 'Chainlink OTC', 'OTC', 80, TRUE, 'crypto:link', 'us', NULL, 216, NOW(), NOW()),
  -- COMMODITIES
  ('silver-otc',   'SILVER (OTC)',   'Silver OTC',    'OTC', 80, TRUE, 'us', 'us', NULL, 220, NOW(), NOW()),
  ('oil-otc',      'OIL (OTC)',      'Oil OTC',       'OTC', 80, TRUE, 'us', 'us', NULL, 221, NOW(), NOW()),
  ('brent-otc',    'BRENT (OTC)',    'Brent OTC',     'OTC', 80, TRUE, 'gb', 'us', NULL, 222, NOW(), NOW()),
  ('copper-otc',   'COPPER (OTC)',   'Copper OTC',    'OTC', 78, TRUE, 'us', 'us', NULL, 223, NOW(), NOW()),
  ('platinum-otc', 'PLATINUM (OTC)', 'Platinum OTC',  'OTC', 78, TRUE, 'us', 'us', NULL, 224, NOW(), NOW()),
  ('natgas-otc',   'NATGAS (OTC)',   'Natural Gas OTC','OTC', 78, TRUE, 'us', 'us', NULL, 225, NOW(), NOW()),
  ('wheat-otc',    'WHEAT (OTC)',    'Wheat OTC',     'OTC', 78, TRUE, 'us', 'us', NULL, 226, NOW(), NOW()),
  -- INDICES (stocks)
  ('aapl-otc',  'AAPL (OTC)',  'Apple OTC',       'OTC', 78, TRUE, 'us', 'us', NULL, 230, NOW(), NOW()),
  ('msft-otc',  'MSFT (OTC)',  'Microsoft OTC',   'OTC', 78, TRUE, 'us', 'us', NULL, 231, NOW(), NOW()),
  ('googl-otc', 'GOOGL (OTC)', 'Google OTC',      'OTC', 78, TRUE, 'us', 'us', NULL, 232, NOW(), NOW()),
  ('amzn-otc',  'AMZN (OTC)',  'Amazon OTC',      'OTC', 78, TRUE, 'us', 'us', NULL, 233, NOW(), NOW()),
  ('tsla-otc',  'TSLA (OTC)',  'Tesla OTC',       'OTC', 76, TRUE, 'us', 'us', NULL, 234, NOW(), NOW()),
  ('meta-otc',  'META (OTC)',  'Meta OTC',        'OTC', 78, TRUE, 'us', 'us', NULL, 235, NOW(), NOW()),
  ('nvda-otc',  'NVDA (OTC)',  'Nvidia OTC',      'OTC', 78, TRUE, 'us', 'us', NULL, 236, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
