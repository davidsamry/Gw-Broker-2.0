-- OTC Refactor Fase 3 — deterministic engine snapshot.
--
-- One row per asset, UPSERTed every 5s by the worker. On boot, the
-- snapshot is the PRIMARY source of recovery (more accurate than
-- re-deriving from the latest candle/tick because it captures the
-- EMA-smoothed price and the full FSM/liquidity state in one shot).
-- Falls back to candle/tick/seedPrice if snapshot is missing, stale,
-- or fails validation.
--
-- Why a new table instead of expanding otc_market_state +
-- otc_liquidity_state? Single round-trip on boot (one SELECT vs.
-- two), atomic snapshot semantics (everything saved together at the
-- same instant), and a `snapshotVersion` field that future engine
-- changes can bump when the in-memory shape changes — old snapshots
-- get rejected by isSnapshotValid() instead of corrupting the
-- restored state.
--
-- otc_market_state and otc_liquidity_state are kept for now (no
-- destructive drop). A later phase can retire them once the new
-- snapshot has proven itself in production.

CREATE TABLE IF NOT EXISTS otc_engine_snapshot (
  "assetId"          TEXT          PRIMARY KEY REFERENCES otc_assets(id) ON DELETE CASCADE,
  "snapshotVersion"  INT           NOT NULL DEFAULT 1,

  -- Pricing (the two values stepPrice mutates per tick).
  "currentPrice"     DECIMAL(18,5) NOT NULL,
  "smoothedPrice"    DECIMAL(18,5) NOT NULL,

  -- Regime FSM — store as text to match the OtcRegime enum's wire
  -- shape without needing a cast on read (enum exists in PG already).
  "regime"           "OtcRegime"   NOT NULL,
  "regimeStartedAt"  TIMESTAMPTZ(3) NOT NULL,
  "regimeDurationMs" INTEGER       NOT NULL,

  -- Liquidity model.
  "spread"           DOUBLE PRECISION NOT NULL DEFAULT 0.0001,
  "buyPressure"      DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "sellPressure"     DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "volume"           DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "depth"            DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "speed"            DOUBLE PRECISION NOT NULL DEFAULT 1.0,

  -- Admin override (in-mem only previously).
  "trendBias"        DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Provenance markers — let the boot logger report how stale the
  -- snapshot was and which tick/candle it last reflected.
  "lastTickTime"     TIMESTAMPTZ(3),
  "lastCandleTime"   TIMESTAMPTZ(3),

  "updatedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);

-- Index on updatedAt for "how old is the freshest snapshot" admin
-- queries. Not used by the worker's primary boot path (PK lookup is
-- enough), but small enough to keep around.
CREATE INDEX IF NOT EXISTS "otc_engine_snapshot_updatedAt_idx"
  ON otc_engine_snapshot ("updatedAt" DESC);
