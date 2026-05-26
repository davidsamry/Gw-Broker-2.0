-- 2026-05-25 — bump OTC v2 tick rate from 10Hz to 20Hz on all 5 assets.
--
-- Founder feedback: "velocidade das movimentações está lenta". Two-prong
-- fix landed together with this migration:
--
--   1. SSE throttle in apps/api/src/otc/v2/routes.ts:
--      TICK_THROTTLE_MS   200 → 50    (5Hz → 20Hz max to client)
--      CANDLE_THROTTLE_MS 1000 → 250  (1Hz → 4Hz in-progress candle)
--
--   2. (THIS FILE) — engine tick rate per asset:
--      speedMultiplier 1.0 → 2.0
--      Worker computes period = max(50, round(100 / speedMultiplier)),
--      so 2.0 yields 50ms per tick = 20Hz engine production.
--
-- Net effect: chart receives 4× more visual updates per second (was
-- capped at 5/s by the old throttle; now 20/s matched with engine).
--
-- IMPORTANT: speedMultiplier only takes effect when the per-asset tick
-- loop is (re)started. The runtime reads it once at startup; admin
-- "pause + resume" rebuilds the loop with the fresh value, but a fresh
-- API restart is the cleanest way to pick it up.
--
-- Volatility per tick unchanged. Doubling tick count without changing
-- per-tick std means per-second std grows by √2 ≈ 1.41× — slightly
-- more energetic movement but not chaotic. M1 body magnitudes go from
-- ~0.10% to ~0.14% on average; wicks similar.

UPDATE otc_assets SET "speedMultiplier" = 2.0 WHERE id = 'eur-usd-otc';
UPDATE otc_assets SET "speedMultiplier" = 2.0 WHERE id = 'gbp-jpy-otc';
UPDATE otc_assets SET "speedMultiplier" = 2.0 WHERE id = 'btc-usd-otc';
UPDATE otc_assets SET "speedMultiplier" = 2.0 WHERE id = 'gold-otc';
UPDATE otc_assets SET "speedMultiplier" = 2.0 WHERE id = 'nasdaq-otc';
