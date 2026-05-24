-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('OPEN_MARKET', 'OTC', 'CRYPTO');

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "payout" INTEGER NOT NULL DEFAULT 85,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "code1" TEXT,
    "code2" TEXT,
    "marketSymbol" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_symbol_key" ON "assets"("symbol");

-- CreateIndex
CREATE INDEX "assets_category_displayOrder_idx" ON "assets"("category", "displayOrder");
