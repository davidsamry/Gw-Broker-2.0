-- Wipe otc_candles a second time so the bootstrap regenerates a clean
-- history with the just-shipped (much smaller) regime drifts. Without
-- this, the only candles in DB after the previous deploy were 1-2 wild
-- minutes captured before drift was calibrated — they'd anchor the
-- chart's y-axis for hours.
--
-- Also wipes otc_ticks: ops opened pre-deploy will resolve via the
-- v1 legacy tick fallback (asset_price_ticks) or random nudge. Worth
-- the tradeoff to give the new engine a true clean slate.

TRUNCATE TABLE otc_candles RESTART IDENTITY;
TRUNCATE TABLE otc_ticks   RESTART IDENTITY;
