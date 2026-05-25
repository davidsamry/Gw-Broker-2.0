-- Fase 7 — index for the candle prune query.
--
-- Existing index on otc_candles is (assetId, timeframe, openTime DESC)
-- — perfect for "give me the chart for asset X" queries (the read
-- path). But the prune SELECT/DELETE filters by (timeframe, openTime)
-- WITHOUT assetId, so the existing index isn't usable in a
-- straightforward range scan: assetId is the leading column, and PG
-- has to scan every assetId bucket separately.
--
-- Adding a 2-column (timeframe, openTime) index lets the prune do a
-- single range scan per timeframe. Write overhead is trivial — ~36k
-- candle rows/day across all assets means ~36k extra index writes/day.
--
-- Without this index, the prune's chunked DELETE could still complete
-- but each chunk's SELECT would do more work than necessary, which
-- (combined with row locks) historically saturated the Prisma pool
-- and caused auth/login 500s. With the index in place, each chunk's
-- SELECT is an index-only scan of ~5k rows = milliseconds.

CREATE INDEX IF NOT EXISTS "otc_candles_timeframe_openTime_idx"
  ON otc_candles (timeframe, "openTime");
