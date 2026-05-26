-- OTC manipulation signals — admin schedules a forced candle outcome.
-- The engine reads this table on every tick; near the end of a slot
-- matching an active signal, it nudges the price so the candle closes
-- in the configured direction (CALL = close > open, PUT = close < open).
-- Outside the targeted slot the engine ticks normally — manipulation
-- is surgical, never persistent.
--
-- `direction` is text + CHECK to avoid creating a new enum type for
-- just two values; same pattern used in other admin tables.

CREATE TABLE "otc_manipulation_signals" (
  "id"          TEXT         PRIMARY KEY,
  "assetId"     TEXT         NOT NULL REFERENCES "otc_assets"("id") ON DELETE CASCADE,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "timeframe"   INTEGER      NOT NULL DEFAULT 60,
  "direction"   TEXT         NOT NULL,
  "enabled"     BOOLEAN      NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otc_manipulation_signals_direction_check"
    CHECK ("direction" IN ('CALL', 'PUT'))
);

-- Hot-path lookup: engine queries by (assetId, scheduledAt window) on
-- every tick. Index sorted by scheduledAt DESC because most queries
-- look at signals in the near future, not historic ones.
CREATE INDEX "otc_manipulation_signals_assetId_scheduledAt_idx"
  ON "otc_manipulation_signals" ("assetId", "scheduledAt" DESC);

-- Single-row settings — master kill switch. The engine checks
-- `enabled` once per tick batch (cheap) and short-circuits all signal
-- processing when off. id='global' is the only row this table ever
-- has, kept as a row for simplicity (vs. an env var) so admin can
-- flip it from the UI without a redeploy.
CREATE TABLE "otc_manipulation_settings" (
  "id"        TEXT         PRIMARY KEY DEFAULT 'global',
  "enabled"   BOOLEAN      NOT NULL DEFAULT FALSE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "otc_manipulation_settings" ("id", "enabled") VALUES ('global', FALSE)
  ON CONFLICT DO NOTHING;
