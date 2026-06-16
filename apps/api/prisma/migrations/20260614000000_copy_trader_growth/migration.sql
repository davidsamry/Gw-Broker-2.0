-- Copy Trading: crescimento "orgânico" diário (copiadores + negociações +5..7/dia).
-- lastGrowthAt marca o último incremento por trader. Aditivo e idempotente.
ALTER TABLE "copy_traders" ADD COLUMN IF NOT EXISTS "lastGrowthAt" TIMESTAMP(3);
