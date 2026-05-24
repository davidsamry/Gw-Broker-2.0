-- User feedback: even with the calmer drifts and new vol, the chart
-- still looks "frozen" during LATERAL stretches. The previous 0.0001
-- (EUR/USD) was tuned for realism — too conservative for a binary
-- options product where users need to SEE the candles moving every
-- second. Doubling brings per-minute std into the 40-50 pip range,
-- comparable to Quotex's visible OTC behavior, while keeping the
-- drift-vs-noise balance the previous calibration achieved.
--
--   EUR/USD: 0.00010 → 0.00020  (~50 pips/min @ 1-sigma)
--   GBP/JPY: 0.00015 → 0.00030
--   BTC/USD: 0.00040 → 0.00080
--   GOLD:    0.00012 → 0.00025
--   NASDAQ:  0.00010 → 0.00022
--
-- Also wipes otc_candles so bootstrap regenerates history with the new
-- (more dynamic) gaussian random walk formula from the same deploy.

UPDATE otc_assets SET "volatilityBase" = 0.00020 WHERE id = 'eur-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00030 WHERE id = 'gbp-jpy-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00080 WHERE id = 'btc-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00025 WHERE id = 'gold-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00022 WHERE id = 'nasdaq-otc';

TRUNCATE TABLE otc_candles RESTART IDENTITY;
