-- CreateEnum
CREATE TYPE "OtcCategory" AS ENUM ('FOREX', 'CRYPTO', 'COMMODITIES', 'INDICES');

-- CreateEnum
CREATE TYPE "OtcRegime" AS ENUM ('LATERAL', 'TREND_UP_WEAK', 'TREND_UP_STRONG', 'TREND_DOWN_WEAK', 'TREND_DOWN_STRONG', 'HIGH_VOL', 'LOW_VOL', 'COMPRESSION', 'EXPANSION');

-- CreateEnum
CREATE TYPE "OtcEventDirection" AS ENUM ('UP', 'DOWN', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "OtcEventStrength" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "OtcEventStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "otc_assets" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "OtcCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "payout" INTEGER NOT NULL DEFAULT 85,
    "seedPrice" DECIMAL(18,5) NOT NULL,
    "volatilityBase" DOUBLE PRECISION NOT NULL DEFAULT 0.0005,
    "speedMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otc_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otc_ticks" (
    "id" BIGSERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "price" DECIMAL(18,5) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otc_ticks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otc_candles" (
    "id" BIGSERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "timeframe" INTEGER NOT NULL,
    "openTime" TIMESTAMPTZ(3) NOT NULL,
    "openPrice" DECIMAL(18,5) NOT NULL,
    "highPrice" DECIMAL(18,5) NOT NULL,
    "lowPrice" DECIMAL(18,5) NOT NULL,
    "closePrice" DECIMAL(18,5) NOT NULL,
    "tickCount" INTEGER NOT NULL,
    "finalizedAt" TIMESTAMPTZ(3),

    CONSTRAINT "otc_candles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otc_market_state" (
    "assetId" TEXT NOT NULL,
    "currentRegime" "OtcRegime" NOT NULL DEFAULT 'LATERAL',
    "regimeStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regimeDurationS" INTEGER NOT NULL DEFAULT 60,
    "currentDrift" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentVol" DOUBLE PRECISION NOT NULL DEFAULT 0.0005,
    "trendBias" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otc_market_state_pkey" PRIMARY KEY ("assetId")
);

-- CreateTable
CREATE TABLE "otc_liquidity_state" (
    "assetId" TEXT NOT NULL,
    "spread" DOUBLE PRECISION NOT NULL DEFAULT 0.0001,
    "buyPressure" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sellPressure" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "depth" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otc_liquidity_state_pkey" PRIMARY KEY ("assetId")
);

-- CreateTable
CREATE TABLE "otc_scheduled_events" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "direction" "OtcEventDirection" NOT NULL,
    "strength" "OtcEventStrength" NOT NULL,
    "volatility" DOUBLE PRECISION,
    "note" TEXT,
    "status" "OtcEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otc_scheduled_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otc_engine_logs" (
    "id" BIGSERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otc_engine_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otc_admin_logs" (
    "id" BIGSERIAL NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assetId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otc_admin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "otc_assets_symbol_key" ON "otc_assets"("symbol");

-- CreateIndex
CREATE INDEX "otc_assets_category_displayOrder_idx" ON "otc_assets"("category", "displayOrder");

-- CreateIndex
CREATE INDEX "otc_ticks_assetId_recordedAt_idx" ON "otc_ticks"("assetId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "otc_candles_assetId_timeframe_openTime_idx" ON "otc_candles"("assetId", "timeframe", "openTime" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "otc_candles_assetId_timeframe_openTime_key" ON "otc_candles"("assetId", "timeframe", "openTime");

-- CreateIndex
CREATE INDEX "otc_scheduled_events_status_startAt_idx" ON "otc_scheduled_events"("status", "startAt");

-- CreateIndex
CREATE INDEX "otc_scheduled_events_assetId_status_idx" ON "otc_scheduled_events"("assetId", "status");

-- CreateIndex
CREATE INDEX "otc_engine_logs_createdAt_idx" ON "otc_engine_logs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "otc_admin_logs_assetId_createdAt_idx" ON "otc_admin_logs"("assetId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "otc_admin_logs_adminId_createdAt_idx" ON "otc_admin_logs"("adminId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "otc_ticks" ADD CONSTRAINT "otc_ticks_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "otc_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otc_candles" ADD CONSTRAINT "otc_candles_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "otc_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otc_market_state" ADD CONSTRAINT "otc_market_state_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "otc_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otc_liquidity_state" ADD CONSTRAINT "otc_liquidity_state_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "otc_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otc_scheduled_events" ADD CONSTRAINT "otc_scheduled_events_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "otc_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
