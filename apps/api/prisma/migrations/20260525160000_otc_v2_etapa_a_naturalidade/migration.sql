-- OTC Recalibração — Etapa A da naturalidade.
--
-- User feedback (2026-05-25 evening): "muitas velas repetitivas,
-- pouco pavio, velocidade baixa". The previous full recalibration
-- (20260525130000) halved volatility for runaway safety AND we layered
-- in M4 reversion 2× bump + soft barrier. Combined effect: too obedient
-- — chart became visually dead.
--
-- Etapa A bumps volatility back ~80% of the runaway-era values (NOT
-- the full 2× that originally caused the runaway). Combined with the
-- engine code change in this same commit (EMA α 0.3 → 0.6), we expect:
--   • Bodies ~3× bigger on average
--   • Visible wicks on most candles
--   • Same anchor-to-seed behavior (reversion + soft barrier unchanged)
--
-- The soft barrier (engages at |distRatio| > 0.3) is the safety net
-- here — even at the bumped volatility, runaway can't happen because
-- the barrier grows quadratically before the hard clamp.
--
-- Per-asset bump factor = 1.8× from current values. Ratios between
-- assets preserved (FX < crypto < commodity etc).
--
--   asset         before      after       (original was)
--   eur-usd-otc   0.00010 →   0.00018     (0.00020 pre-recalibration)
--   gbp-jpy-otc   0.00015 →   0.00027     (0.00030)
--   btc-usd-otc   0.00040 →   0.00072     (0.00080)
--   gold-otc      0.00012 →   0.00022     (0.00025)
--   nasdaq-otc    0.00010 →   0.00018     (0.00022)
--
-- Note: NO truncate of candles, ticks, or snapshot. Old (smaller)
-- candles fade off naturally as the chart scrolls; the prune job
-- handles deeper history. On API restart the new vol values take
-- effect from the next tick — visible "things got more alive" moment
-- at the join, which is the intended UX signal.

UPDATE otc_assets SET "volatilityBase" = 0.00018 WHERE id = 'eur-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00027 WHERE id = 'gbp-jpy-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00072 WHERE id = 'btc-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00022 WHERE id = 'gold-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00018 WHERE id = 'nasdaq-otc';
