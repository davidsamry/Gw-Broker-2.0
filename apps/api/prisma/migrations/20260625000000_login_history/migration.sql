-- Histórico de IPs de acesso (login). 1 linha por (userId, ip); o login faz
-- upsert atômico via ON CONFLICT. Aditivo e idempotente.
CREATE TABLE IF NOT EXISTS "login_history" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "ip"          TEXT NOT NULL,
  "userAgent"   TEXT,
  "count"       INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "login_history_userId_ip_key" ON "login_history"("userId", "ip");
CREATE INDEX IF NOT EXISTS "login_history_userId_lastSeenAt_idx" ON "login_history"("userId", "lastSeenAt");

DO $$ BEGIN
  ALTER TABLE "login_history"
    ADD CONSTRAINT "login_history_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
