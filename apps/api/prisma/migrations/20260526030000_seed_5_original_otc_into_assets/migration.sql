-- The 5 launch OTC v2 assets (eur-usd-otc, gbp-jpy-otc, btc-usd-otc,
-- gold-otc, nasdaq-otc) live in the `otc_assets` table (engine source
-- of truth) but were never inserted into the admin `assets` table.
-- Reason: an early migration (`keep_only_binance_crypto`) wiped all
-- OTC entries from `assets` before the OTC v2 launch, and the launch
-- seed only populated `otc_assets`.
--
-- Result: admin /ativos shows "OTC (29)" instead of "OTC (34)" and
-- admin can't enable/disable or adjust payout for these 5. Frontend
-- selector still works because it reads from mockData.ts.
--
-- This migration backfills them so the admin sees all 34.
-- ON CONFLICT DO NOTHING — safe to re-run.

INSERT INTO assets (id, symbol, name, category, payout, enabled, code1, code2, "marketSymbol", "displayOrder", "createdAt", "updatedAt") VALUES
  ('eur-usd-otc', 'EUR/USD (OTC)', 'EUR/USD OTC', 'OTC', 85, TRUE, 'eu',          'us', NULL, 100, NOW(), NOW()),
  ('gbp-jpy-otc', 'GBP/JPY (OTC)', 'GBP/JPY OTC', 'OTC', 87, TRUE, 'gb',          'jp', NULL, 101, NOW(), NOW()),
  ('btc-usd-otc', 'BTC/USD (OTC)', 'Bitcoin OTC', 'OTC', 82, TRUE, 'crypto:btc',  'us', NULL, 102, NOW(), NOW()),
  ('gold-otc',    'GOLD (OTC)',    'Gold OTC',    'OTC', 80, TRUE, 'us',          'us', NULL, 103, NOW(), NOW()),
  ('nasdaq-otc',  'NASDAQ (OTC)',  'NASDAQ OTC',  'OTC', 78, TRUE, 'us',          'us', NULL, 104, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
