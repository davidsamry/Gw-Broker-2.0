-- Fase F1 — Forex (cTrader) provider schema.
--
-- Brand-new isolated tables for the upcoming cTrader Open API integration.
-- All names prefixed `forex_*` — zero collision risk with `otc_*` family or
-- the legacy `assets` table. The provider abstraction lives in code under
-- apps/api/src/forex/providers/; this schema is provider-agnostic but
-- includes a ctrader_symbol_id column on assets so the connector knows
-- the broker's numeric mapping at boot.
--
-- Seed: 5 initial forex pairs (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD).
-- ctrader_symbol_id starts NULL; the cTrader client populates it on first
-- successful GetSymbolsListReq response.

-- CreateTable
CREATE TABLE "forex_assets" (
    "id"              TEXT             NOT NULL,
    "symbol"          TEXT             NOT NULL,
    "name"            TEXT             NOT NULL,
    "digits"          INTEGER          NOT NULL,
    "pipSize"         DECIMAL(18,10)   NOT NULL,
    "enabled"         BOOLEAN          NOT NULL DEFAULT true,
    "ctraderSymbolId" INTEGER,
    "displayOrder"    INTEGER          NOT NULL DEFAULT 0,
    "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "forex_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forex_candles" (
    "id"          BIGSERIAL         NOT NULL,
    "assetId"     TEXT              NOT NULL,
    "timeframe"   INTEGER           NOT NULL,
    "openTime"    TIMESTAMPTZ(3)    NOT NULL,
    "openPrice"   DECIMAL(18,6)     NOT NULL,
    "highPrice"   DECIMAL(18,6)     NOT NULL,
    "lowPrice"    DECIMAL(18,6)     NOT NULL,
    "closePrice"  DECIMAL(18,6)     NOT NULL,
    "tickCount"   INTEGER           NOT NULL,
    "finalizedAt" TIMESTAMPTZ(3),

    CONSTRAINT "forex_candles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forex_engine_snapshot" (
    "assetId"         TEXT              NOT NULL,
    "ctraderSymbolId" INTEGER,
    "lastBid"         DECIMAL(18,6),
    "lastAsk"         DECIMAL(18,6),
    "lastTickAt"      TIMESTAMPTZ(3),
    "updatedAt"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forex_engine_snapshot_pkey" PRIMARY KEY ("assetId")
);

-- CreateIndex
CREATE UNIQUE INDEX "forex_assets_symbol_key" ON "forex_assets"("symbol");

-- CreateIndex
CREATE INDEX "forex_assets_enabled_displayOrder_idx"
    ON "forex_assets"("enabled", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "forex_candles_assetId_timeframe_openTime_key"
    ON "forex_candles"("assetId", "timeframe", "openTime");

-- CreateIndex
CREATE INDEX "forex_candles_assetId_timeframe_openTime_idx"
    ON "forex_candles"("assetId", "timeframe", "openTime" DESC);

-- ── Seed initial forex pairs ─────────────────────────────────────────────
-- pipSize = 1 / 10^(digits - 1)  (5-digit prices = pip at 4th decimal)
INSERT INTO "forex_assets" ("id", "symbol", "name", "digits", "pipSize", "displayOrder", "updatedAt") VALUES
  ('eur-usd', 'EURUSD', 'Euro / US Dollar',         5, 0.0001,   1, NOW()),
  ('gbp-usd', 'GBPUSD', 'British Pound / US Dollar', 5, 0.0001,   2, NOW()),
  ('usd-jpy', 'USDJPY', 'US Dollar / Japanese Yen',  3, 0.01,     3, NOW()),
  ('aud-usd', 'AUDUSD', 'Australian Dollar / US Dollar', 5, 0.0001, 4, NOW()),
  ('usd-cad', 'USDCAD', 'US Dollar / Canadian Dollar', 5, 0.0001, 5, NOW());
