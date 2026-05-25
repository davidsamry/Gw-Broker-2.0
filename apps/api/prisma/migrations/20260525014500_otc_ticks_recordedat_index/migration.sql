-- Adds a recordedAt-only index on otc_ticks so the retention-prune's
-- `WHERE recordedAt < NOW() - INTERVAL '1 hour'` scan is index-backed.
-- The existing index is (assetId, recordedAt DESC), which doesn't help
-- a query that doesn't filter by assetId. Without this, even chunked
-- DELETEs scan large portions of the table and hold connections long
-- enough to starve the Prisma pool (auth/login was returning 500s).
--
-- CONCURRENTLY would be ideal to avoid locking inserts, but Prisma's
-- `migrate deploy` runs each statement inside a transaction by default
-- and CREATE INDEX CONCURRENTLY can't run in a transaction. The table
-- is small enough now (post-retention) that a brief lock is fine.

CREATE INDEX IF NOT EXISTS "otc_ticks_recordedAt_idx"
  ON otc_ticks ("recordedAt");
