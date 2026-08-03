-- click_id (param `sck` da URL do bot) na user_tracking. Usado como
-- external_id nos postbacks pro TrackFlow. Aditivo e idempotente.
ALTER TABLE "user_tracking" ADD COLUMN IF NOT EXISTS "sck" TEXT;
