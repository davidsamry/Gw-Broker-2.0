-- Multi-gateway de depósitos PIX (BSPay + Versell).
--
-- Aditivo e idempotente. NÃO altera registros existentes da BSPay:
--   - deposits.paymentGateway fica NULL nos registros antigos; o código trata
--     NULL como 'bspay' (compatibilidade com relatórios/conciliações atuais).
--   - platform_settings.depositGateway nasce 'bspay', mantendo o comportamento
--     de produção EXATAMENTE como está hoje até o admin trocar manualmente.

ALTER TABLE "deposits" ADD COLUMN IF NOT EXISTS "paymentGateway" TEXT;

-- Índice pro lookup do webhook Versell (busca o depósito pelo txid salvo em externalId).
CREATE INDEX IF NOT EXISTS "deposits_externalId_idx" ON "deposits"("externalId");

ALTER TABLE "platform_settings"
  ADD COLUMN IF NOT EXISTS "depositGateway" TEXT NOT NULL DEFAULT 'bspay';
