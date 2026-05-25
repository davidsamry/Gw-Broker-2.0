-- Fase B1 — Bonus system schema.
--
-- Two tables:
--   bonuses        — admin-defined codes (config). Edit via /admin/bonuses.
--   bonus_grants   — per-user redemption instances. Created when a user
--                    submits a deposit with a valid code; status flips to
--                    ACTIVE when the deposit confirms (PAID) and the
--                    bonus amount is credited to the account.
--
-- Constraint enforced by partial unique index: a user can have at most ONE
-- grant in PENDING or ACTIVE state at any time. Prevents stacking bonuses
-- (the founder explicitly chose 1-at-a-time during scope review).
--
-- Rollover tracking (rolloverProgress) is updated by the operations worker
-- in Fase B2 (separate commit). For Fase B1 the value stays at 0 — withdrawal
-- blocking based on rollover is wired in B2 as well.

-- CreateEnum
CREATE TYPE "BonusType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "BonusGrantStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "bonuses" (
    "id"             TEXT          NOT NULL,
    "code"           TEXT          NOT NULL,
    "type"           "BonusType"   NOT NULL,
    "value"          DECIMAL(10,2) NOT NULL,
    "minDeposit"     DECIMAL(18,2) NOT NULL,
    "rollover"       INTEGER       NOT NULL,
    "active"         BOOLEAN       NOT NULL DEFAULT true,
    "maxUsesPerUser" INTEGER       NOT NULL DEFAULT 1,
    "expiresAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_grants" (
    "id"               TEXT                NOT NULL,
    "userId"           TEXT                NOT NULL,
    "bonusId"          TEXT                NOT NULL,
    "depositId"        TEXT,
    "bonusAmount"      DECIMAL(18,2)       NOT NULL,
    "rolloverRequired" DECIMAL(18,2)       NOT NULL,
    "rolloverProgress" DECIMAL(18,2)       NOT NULL DEFAULT 0,
    "status"           "BonusGrantStatus"  NOT NULL DEFAULT 'PENDING',
    "grantedAt"        TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"      TIMESTAMP(3),
    "cancelledAt"      TIMESTAMP(3),

    CONSTRAINT "bonus_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bonuses_code_key" ON "bonuses"("code");

-- CreateIndex
CREATE INDEX "bonus_grants_userId_status_idx" ON "bonus_grants"("userId", "status");

-- CreateIndex
CREATE INDEX "bonus_grants_status_idx" ON "bonus_grants"("status");

-- Partial unique index: at most ONE pending+active grant per user. Postgres
-- supports this via `WHERE` clause on the unique constraint; Prisma doesn't
-- emit it from the schema yet so we create it manually here.
CREATE UNIQUE INDEX "bonus_grants_userId_one_open_grant"
    ON "bonus_grants"("userId")
    WHERE "status" IN ('PENDING', 'ACTIVE');

-- AddForeignKey
ALTER TABLE "bonus_grants" ADD CONSTRAINT "bonus_grants_bonusId_fkey"
    FOREIGN KEY ("bonusId") REFERENCES "bonuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
