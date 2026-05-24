-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "seedPrice" DECIMAL(18,5),
ADD COLUMN     "tickIntervalMs" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.0005;

-- CreateTable
CREATE TABLE "asset_price_ticks" (
    "id" BIGSERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "price" DECIMAL(18,5) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_price_ticks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_price_ticks_assetId_recordedAt_idx" ON "asset_price_ticks"("assetId", "recordedAt" DESC);

-- AddForeignKey
ALTER TABLE "asset_price_ticks" ADD CONSTRAINT "asset_price_ticks_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
