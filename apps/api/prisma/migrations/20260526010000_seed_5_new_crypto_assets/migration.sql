-- Seed 5 new crypto pairs that were added to the catalog (apps/api/src/
-- market/catalog.ts + apps/web/src/lib/mockData.ts) but not yet present
-- in the admin `assets` table. Without this seed the admin page shows
-- 17 entries while the trading selector shows 22 — admin couldn't
-- enable/disable or adjust payout for AAVE/UNI/NEAR/APT/ARB.
--
-- ON CONFLICT DO NOTHING — safe to re-run; existing rows aren't touched.
-- Display order continues from 166 (last one was sui-usdt-binance @ 166).

INSERT INTO assets (id, symbol, name, category, payout, enabled, code1, code2, "marketSymbol", "displayOrder", "createdAt", "updatedAt") VALUES
  ('aave-usdt-binance', 'AAVE/USDT', 'Aave / USDT',     'CRYPTO', 90, TRUE, 'crypto:aave', 'us', 'AAVEUSDT', 167, NOW(), NOW()),
  ('uni-usdt-binance',  'UNI/USDT',  'Uniswap / USDT',  'CRYPTO', 90, TRUE, 'crypto:uni',  'us', 'UNIUSDT',  168, NOW(), NOW()),
  ('near-usdt-binance', 'NEAR/USDT', 'NEAR / USDT',     'CRYPTO', 89, TRUE, 'crypto:near', 'us', 'NEARUSDT', 169, NOW(), NOW()),
  ('apt-usdt-binance',  'APT/USDT',  'Aptos / USDT',    'CRYPTO', 89, TRUE, 'crypto:apt',  'us', 'APTUSDT',  170, NOW(), NOW()),
  ('arb-usdt-binance',  'ARB/USDT',  'Arbitrum / USDT', 'CRYPTO', 89, TRUE, 'crypto:arb',  'us', 'ARBUSDT',  171, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
