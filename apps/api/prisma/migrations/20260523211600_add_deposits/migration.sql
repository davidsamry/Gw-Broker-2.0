-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepositMethod" AS ENUM ('PIX', 'CREDIT_CARD', 'BANK_TRANSFER', 'CRYPTO');

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "bonus" DECIMAL(18,2),
    "method" "DepositMethod" NOT NULL DEFAULT 'PIX',
    "externalId" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "isFake" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deposits_status_createdAt_idx" ON "deposits"("status", "createdAt");

-- CreateIndex
CREATE INDEX "deposits_accountId_status_idx" ON "deposits"("accountId", "status");

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
