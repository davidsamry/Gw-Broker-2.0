-- Drop the cTrader-backed forex tables introduced in
-- 20260525200000_add_forex_schema and 20260526120000_forex_finalized_at.
-- The integration is being removed entirely; these tables are orphan now.
-- CASCADE is safe — no other table references them (forex was isolated by
-- design, see schema.prisma).
DROP TABLE IF EXISTS "forex_engine_snapshot" CASCADE;
DROP TABLE IF EXISTS "forex_candles"         CASCADE;
DROP TABLE IF EXISTS "forex_assets"          CASCADE;
