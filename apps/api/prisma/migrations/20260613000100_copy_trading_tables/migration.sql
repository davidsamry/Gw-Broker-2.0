-- Copy Trading — tabelas isoladas. NÃO referenciam operations/rollover/ranking.
-- IF NOT EXISTS pra ser seguro de re-aplicar.

CREATE TABLE IF NOT EXISTS "copy_traders" (
  "id"            TEXT          NOT NULL,
  "name"          TEXT          NOT NULL,
  "countryCode"   TEXT          NOT NULL DEFAULT 'br',
  "avatarUrl"     TEXT,
  "vip"           BOOLEAN       NOT NULL DEFAULT false,
  "paid"          BOOLEAN       NOT NULL DEFAULT false,
  "accessPrice"   DECIMAL(18,2) NOT NULL DEFAULT 0,
  "weeklyGainPct" DECIMAL(6,2)  NOT NULL DEFAULT 0,
  "copiers"       INTEGER       NOT NULL DEFAULT 0,
  "copiedTrades"  INTEGER       NOT NULL DEFAULT 0,
  "commissionPct" INTEGER       NOT NULL DEFAULT 0,
  "profitPct"     INTEGER       NOT NULL DEFAULT 0,
  "lossPct"       INTEGER       NOT NULL DEFAULT 0,
  "active"        BOOLEAN       NOT NULL DEFAULT true,
  "displayOrder"  INTEGER       NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "copy_traders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "copy_traders_active_order_idx" ON "copy_traders" ("active", "displayOrder");

CREATE TABLE IF NOT EXISTS "user_copy_traders" (
  "id"          TEXT          NOT NULL,
  "userId"      TEXT          NOT NULL,
  "traderId"    TEXT          NOT NULL,
  "activatedAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pricePaid"   DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status"      TEXT          NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_copy_traders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "user_copy_traders_user_status_idx" ON "user_copy_traders" ("userId", "status");
CREATE INDEX IF NOT EXISTS "user_copy_traders_trader_idx" ON "user_copy_traders" ("traderId");

CREATE TABLE IF NOT EXISTS "copy_trade_operations" (
  "id"            TEXT          NOT NULL,
  "userId"        TEXT          NOT NULL,
  "traderId"      TEXT          NOT NULL,
  "result"        TEXT          NOT NULL,
  "amount"        DECIMAL(18,2) NOT NULL DEFAULT 0,
  "pnl"           DECIMAL(18,2) NOT NULL DEFAULT 0,
  "is_copy_trade" BOOLEAN       NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "copy_trade_operations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "copy_trade_operations_user_trader_idx" ON "copy_trade_operations" ("userId", "traderId");

-- ── Seed dos 8 traders (admin edita depois). ON CONFLICT DO NOTHING ──────────
INSERT INTO "copy_traders"
  ("id","name","countryCode","vip","paid","accessPrice","weeklyGainPct","copiers","copiedTrades","commissionPct","profitPct","lossPct","active","displayOrder")
VALUES
  ('ct_diego',   'Diego',        'br', true,  true,   97.00, 76.00,   3,  203, 10, 71, 29, true, 1),
  ('ct_mei',     'Mei L.',       'jp', true,  true,  249.00, 70.00,   2,   75, 18, 72, 28, true, 2),
  ('ct_traderpro','TraderPro',   'us', true,  false,   0.00, 61.00,  15, 1320, 12, 70, 30, true, 3),
  ('ct_hardu',   'Hardu',        'br', true,  true,  147.00, 64.00,   5,  410, 15, 66, 34, true, 4),
  ('ct_175370154','175370154',   'id', true,  true,  197.00, 59.00,   1,   12, 20, 74, 26, true, 5),
  ('ct_espina',  'Espinatrader', 'br', true,  true,  147.00, 57.00,   8, 5086, 10, 68, 32, true, 6),
  ('ct_carla',   'Carla M.',     'br', false, false,   0.00, 52.00,  24,  890,  8, 64, 36, true, 7),
  ('ct_lucas',   'Lucas F.',     'br', false, false,   0.00, 48.00,  40, 2100,  7, 60, 40, true, 8)
ON CONFLICT ("id") DO NOTHING;
