-- Copy Trading: operações deixam de ser display-only e passam a LIQUIDAR no
-- tempo (escalonadas: 1ª em 1min, demais a cada 30min). Aditivo e idempotente.

ALTER TABLE "copy_trade_operations" ADD COLUMN IF NOT EXISTS "status"      TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "copy_trade_operations" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
ALTER TABLE "copy_trade_operations" ADD COLUMN IF NOT EXISTS "settledAt"   TIMESTAMP(3);

-- Ops já existentes (testes antigos, eram display-only) viram SETTLED pra
-- continuarem aparecendo no histórico. Elas nunca tocaram saldo — só marcamos
-- como liquidadas pro worker não reprocessar.
UPDATE "copy_trade_operations"
   SET "status" = 'SETTLED', "settledAt" = "createdAt"
 WHERE "status" = 'PENDING' AND "settledAt" IS NULL;

CREATE INDEX IF NOT EXISTS "copy_trade_operations_status_scheduledAt_idx"
    ON "copy_trade_operations" ("status", "scheduledAt");
