-- Admin user-edit drawer fields. Adds admin toggles, per-user payout
-- overrides, per-user market permissions, and direct bonus balance +
-- rollover state on accounts. All default to safe values for existing
-- users (no behavior change until admin explicitly toggles).

-- ── users ──────────────────────────────────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN "isFake"                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "copyTraderEnabled"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payoutOverrideForex"   INTEGER,
  ADD COLUMN "payoutOverrideOtc"     INTEGER,
  ADD COLUMN "payoutOverrideCrypto"  INTEGER,
  ADD COLUMN "canTradeForex"         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canTradeOtc"           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canTradeCrypto"        BOOLEAN NOT NULL DEFAULT true;

-- Validate payout overrides are sensible (0-100). NULL stays allowed.
ALTER TABLE "users"
  ADD CONSTRAINT "users_payoutOverrideForex_range"
    CHECK ("payoutOverrideForex" IS NULL OR ("payoutOverrideForex" BETWEEN 0 AND 100)),
  ADD CONSTRAINT "users_payoutOverrideOtc_range"
    CHECK ("payoutOverrideOtc" IS NULL OR ("payoutOverrideOtc" BETWEEN 0 AND 100)),
  ADD CONSTRAINT "users_payoutOverrideCrypto_range"
    CHECK ("payoutOverrideCrypto" IS NULL OR ("payoutOverrideCrypto" BETWEEN 0 AND 100));

-- ── accounts ───────────────────────────────────────────────────────────────
-- Admin-direct bonus balance + rollover state. Independent from the
-- BonusGrant table — that one tracks per-code redemptions; these are
-- for lump-sum admin edits in the user drawer.
ALTER TABLE "accounts"
  ADD COLUMN "bonusBalance"     DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "rolloverRequired" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "rolloverProgress" DECIMAL(18,2) NOT NULL DEFAULT 0;
