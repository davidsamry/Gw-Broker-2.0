-- Outbound webhook configuration — per-event URL + on/off toggle.
-- Lives behind /admin/webhooks UI. Three rows seeded with the canonical
-- event keys (REGISTRATION, FIRST_DEPOSIT, SUBSEQUENT_DEPOSIT). Disabled
-- by default so a fresh deploy doesn't accidentally start posting to a
-- stale URL.

CREATE TABLE IF NOT EXISTS "webhook_configs" (
  "id"        TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "url"       TEXT NOT NULL DEFAULT '',
  "active"    BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "webhook_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_configs_key_key"
  ON "webhook_configs"("key");

-- Seed the 3 canonical event keys. ON CONFLICT lets the migration re-run
-- safely if someone manually inserted one already. updatedAt = NOW() so
-- the row's never NULL.
INSERT INTO "webhook_configs" ("id", "key", "url", "active", "createdAt", "updatedAt")
VALUES
  ('whc_registration',        'REGISTRATION',        '', FALSE, NOW(), NOW()),
  ('whc_first_deposit',       'FIRST_DEPOSIT',       '', FALSE, NOW(), NOW()),
  ('whc_subsequent_deposit',  'SUBSEQUENT_DEPOSIT',  '', FALSE, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
