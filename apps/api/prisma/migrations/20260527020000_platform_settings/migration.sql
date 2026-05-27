-- Singleton platform settings — one row, id='global'.
-- See prisma/schema.prisma PlatformSettings model + apps/api/src/settings
-- for the runtime cache + admin endpoints that read/write this row.

CREATE TABLE "platform_settings" (
    "id"                     TEXT NOT NULL DEFAULT 'global',
    "withdrawalFeePct"       DECIMAL(5,2)  NOT NULL DEFAULT 0,
    "withdrawalMin"          DECIMAL(18,2) NOT NULL DEFAULT 60,
    "withdrawalMax"          DECIMAL(18,2) NOT NULL DEFAULT 10000,
    "depositMin"             DECIMAL(18,2) NOT NULL DEFAULT 60,
    "depositMax"             DECIMAL(18,2) NOT NULL DEFAULT 100000,
    "depositRollover"        DECIMAL(6,2)  NOT NULL DEFAULT 2,
    "operationMin"           DECIMAL(18,2) NOT NULL DEFAULT 5,
    "operationMax"           DECIMAL(18,2) NOT NULL DEFAULT 100000,
    "operationMinIntervalMs" INTEGER       NOT NULL DEFAULT 1000,
    "copyTradeEnabled"       BOOLEAN       NOT NULL DEFAULT true,
    "updatedAt"              TIMESTAMP(3)  NOT NULL,
    "createdAt"              TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row with the defaults pulled from the codebase's
-- previous hardcoded constants (MIN_DEPOSIT=60, MAX_DEPOSIT=100k, etc.)
INSERT INTO "platform_settings" ("id", "updatedAt") VALUES ('global', NOW());
