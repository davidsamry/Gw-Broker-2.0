-- Revert the 20260525210000 speed bump.
--
-- The previous migration set speedMultiplier 1.0 → 2.0 with the goal of
-- making the chart "feel faster". Side effect: 2× tick rate at same
-- per-tick volatility = √2 bigger per-second moves. Visible result was
-- 6+ consecutive same-direction candles, all similar size, no wicks —
-- exactly the "staircase / artificial" pattern the founder wanted gone.
--
-- Going back to 10Hz on the engine. The SSE throttle relax (50ms /
-- 250ms) stays — that's purely visual smoothness (more updates per
-- second of the SAME walk) and doesn't change candle magnitudes.
--
-- Wick visibility is now addressed in the micro layer instead — the
-- companion code change in microdynamics.ts multiplies the jitter
-- variance ~3× so wicks emerge at the original macro scale without
-- amplifying the macro itself.

UPDATE otc_assets SET "speedMultiplier" = 1.0 WHERE id = 'eur-usd-otc';
UPDATE otc_assets SET "speedMultiplier" = 1.0 WHERE id = 'gbp-jpy-otc';
UPDATE otc_assets SET "speedMultiplier" = 1.0 WHERE id = 'btc-usd-otc';
UPDATE otc_assets SET "speedMultiplier" = 1.0 WHERE id = 'gold-otc';
UPDATE otc_assets SET "speedMultiplier" = 1.0 WHERE id = 'nasdaq-otc';
