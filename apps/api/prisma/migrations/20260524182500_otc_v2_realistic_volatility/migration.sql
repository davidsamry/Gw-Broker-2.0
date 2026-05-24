-- Etapa 6.1 — Realistic volatility for OTC v2 assets.
--
-- The original seed (Etapa 1) set volatilityBase = 0.0003 (30 bp per
-- 100ms tick) for EUR/USD. At 10 ticks/sec × 60s = 600 ticks/minute,
-- cumulative 1-sigma move = 0.0003 × √600 = 0.73% per minute.
-- With regime multipliers (up to 1.8×) and volume (up to 2.0×), the
-- effective per-tick stddev can reach 0.00108 — pushing 1-min 3-sigma
-- moves above 7-8%. Production caught 14% candles (1.18 → 1.345 in
-- 60s for EUR/USD), which is ~50× real forex behavior.
--
-- New values calibrated so each asset's expected 1-min stddev sits
-- in the 20-50bp range — visible candle bodies for binary options
-- trading without the chart-eating swings the old values produced:
--
--   EUR/USD: 0.00010  (~0.24% per min @ 1-sigma → ~25 pip candle range)
--   GBP/JPY: 0.00015  (~0.37% — JPY pairs naturally swing more)
--   BTC/USD: 0.00040  (~0.98% — crypto)
--   GOLD:    0.00012  (~0.29%)
--   NASDAQ:  0.00010  (~0.24%)
--
-- After the worker reloads (auto on restart), price movement will
-- be visible but bounded — no more 5-14% candles like the production
-- catch (1.18 → 1.345 in 60s for EUR/USD = 14% / minute).

UPDATE otc_assets SET "volatilityBase" = 0.00010 WHERE id = 'eur-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00015 WHERE id = 'gbp-jpy-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00040 WHERE id = 'btc-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00012 WHERE id = 'gold-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00010 WHERE id = 'nasdaq-otc';

-- Wipe corrupted history so the bootstrap regenerates a clean 3000-candle
-- backlog using the new (realistic) volatility. The previous data — both
-- the structurally broken rows and the wildly volatile-but-valid ones —
-- would otherwise haunt the chart for the next 50h (3000 × 60s) until
-- they scroll off. Ticks are kept intact (audit trail for any open ops
-- that haven't expired yet).
TRUNCATE TABLE otc_candles RESTART IDENTITY;
