-- Copy Trading: ciclo recorrente. Após um ciclo de 5 ops terminar, o copyWorker
-- gera outro 24h depois. `nextCycleAt` marca quando reiniciar (claim atômico).
-- Aditivo e idempotente.
ALTER TABLE "user_copy_traders" ADD COLUMN IF NOT EXISTS "nextCycleAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "user_copy_traders_status_nextCycleAt_idx"
    ON "user_copy_traders" ("status", "nextCycleAt");
