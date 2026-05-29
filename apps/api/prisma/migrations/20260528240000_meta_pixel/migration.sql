-- Meta Conversions API integration — admin configures Pixel ID + token via
-- /admin/meta-pixel (NO env vars). Three tables:
--
--   1. meta_pixel_settings — single global row, holds enabled flag + creds.
--   2. user_tracking       — per-user fbp/fbc/utm captured at registration.
--   3. meta_events_log     — every dispatch (success or fail), used for
--                            dedupe + audit + debugging.
--
-- All additive — no existing table is modified.

-- ── 1. Settings (single row, id='global') ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "meta_pixel_settings" (
  "id"              TEXT NOT NULL DEFAULT 'global',
  "enabled"         BOOLEAN NOT NULL DEFAULT FALSE,
  "pixelId"         TEXT,
  "pixelToken"      TEXT,
  "testEventCode"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_pixel_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the single row so the admin UI always has something to PATCH.
INSERT INTO "meta_pixel_settings" ("id", "enabled", "updatedAt")
VALUES ('global', FALSE, NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 2. User tracking (captured at register) ──────────────────────────────
CREATE TABLE IF NOT EXISTS "user_tracking" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "fbp"            TEXT,
  "fbc"            TEXT,
  "fbclid"         TEXT,
  "utmSource"      TEXT,
  "utmMedium"      TEXT,
  "utmCampaign"    TEXT,
  "utmContent"     TEXT,
  "utmTerm"        TEXT,
  "ip"             TEXT,
  "userAgent"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_tracking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_tracking_userId_key" ON "user_tracking"("userId");

ALTER TABLE "user_tracking"
  ADD CONSTRAINT "user_tracking_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Events log (dedupe + audit) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "meta_events_log" (
  "id"           TEXT NOT NULL,
  "eventName"    TEXT NOT NULL,
  "eventId"      TEXT NOT NULL,
  "userId"       TEXT,
  "depositId"    TEXT,
  "payload"      JSONB NOT NULL,
  "response"     JSONB,
  "success"      BOOLEAN NOT NULL DEFAULT FALSE,
  "errorMessage" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_events_log_pkey" PRIMARY KEY ("id")
);

-- Dedupe queries (`WHERE eventId=… AND success=TRUE LIMIT 1`) need this.
CREATE INDEX IF NOT EXISTS "meta_events_log_eventId_idx" ON "meta_events_log"("eventId");
CREATE INDEX IF NOT EXISTS "meta_events_log_userId_idx"  ON "meta_events_log"("userId");
CREATE INDEX IF NOT EXISTS "meta_events_log_createdAt_idx" ON "meta_events_log"("createdAt" DESC);
