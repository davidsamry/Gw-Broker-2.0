-- Endereço granular no perfil (city/state/zip) — enriquece os webhooks de
-- tracking (advanced matching). Aditivo e idempotente.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "city"  TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "zip"   TEXT;
