-- Auto-liquidez (auto-throttle quando user lucra X% sobre a banca atual)
--
-- Duas colunas, idempotentes:
--
-- 1. users.bankrollBaseline — saldo REAL no momento do último depósito
--    confirmado. Resetado pelo deposits/service.ts ao marcar PAID.
--    Backfill: usa o saldo REAL atual de cada user, garantindo que a
--    trigger só dispare em LUCRO FUTURO (não recalcula histórico).
--
-- 2. platform_settings.autoLiquidityProfitPct — threshold (em %) que
--    dispara a auto-ativação de Liquidez + bloqueio de Cripto.
--    Default 20 = quando saldo >= baseline * 1.20.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "bankrollBaseline" DECIMAL(18, 2) NOT NULL DEFAULT 0;

-- Backfill: usuários EXISTENTES recebem baseline = saldo REAL atual.
-- Sem isso, qualquer user com saldo > 0 dispararia a trigger no primeiro
-- WIN porque baseline=0 ⇒ saldo/0 = Infinity. Idempotente: só toca users
-- que ainda têm baseline=0 (caso raro de re-run da migration).
UPDATE "users" u
  SET "bankrollBaseline" = COALESCE((
    SELECT a.balance FROM "accounts" a
    WHERE a."userId" = u.id AND a.type = 'REAL'
    LIMIT 1
  ), 0)
  WHERE u."bankrollBaseline" = 0;

ALTER TABLE "platform_settings"
  ADD COLUMN IF NOT EXISTS "autoLiquidityProfitPct" INTEGER NOT NULL DEFAULT 20;
