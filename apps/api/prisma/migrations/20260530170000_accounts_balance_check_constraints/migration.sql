-- Sec O1.3: Defesa-em-profundidade — saldos NUNCA podem ficar negativos.
--
-- Hoje a regra "stake <= balance" vive na CTE de createOperation. Se uma
-- nova rota ou um bug de race condition deduzir balance sem checar, dá
-- pra ficar com saldo negativo (= dinheiro impresso do nada). CHECK no
-- nivel do Postgres impede a transacao de commitar mesmo que o codigo
-- da app erre.
--
-- Defensivo: antes de adicionar a CHECK, clampamos qualquer row que
-- por acaso ja esteja < 0 (em prod nao deve ter — mas em ambientes de
-- dev/staging pode). Sem isso o ALTER falharia com
-- "check constraint is violated by some row".

UPDATE "accounts" SET "balance"          = 0 WHERE "balance"          < 0;
UPDATE "accounts" SET "bonusBalance"     = 0 WHERE "bonusBalance"     < 0;
UPDATE "accounts" SET "rolloverRequired" = 0 WHERE "rolloverRequired" < 0;
UPDATE "accounts" SET "rolloverProgress" = 0 WHERE "rolloverProgress" < 0;

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_balance_nonneg_chk"
    CHECK ("balance" >= 0);

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_bonus_balance_nonneg_chk"
    CHECK ("bonusBalance" >= 0);

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_rollover_required_nonneg_chk"
    CHECK ("rolloverRequired" >= 0);

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_rollover_progress_nonneg_chk"
    CHECK ("rolloverProgress" >= 0);
