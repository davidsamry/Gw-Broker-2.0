-- Persiste o estado da regra "max 5 velas iguais" no snapshot do engine.
-- Sem isso, restart do API zerava o counter e o sistema podia perder a
-- contagem no meio de um streak — usuario podia ver 5+5 = 10 velas iguais
-- atravessando um restart.
--
-- 2026-06-01: bug encontrado no Gold OTC (>5 velas seguidas pra mesma
-- direcao). Combinado com fix no loops.ts (nao zerar counter ao armar
-- force-reverse) e bump do FORCE_REVERSE_DRIFT_PER_TICK.

ALTER TABLE "otc_engine_snapshot"
  ADD COLUMN "m1DirectionStreak"   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN "m1LastDirection"     TEXT,
  ADD COLUMN "forceReverseUntilAt" TIMESTAMPTZ(3),
  ADD COLUMN "forceReverseDir"     TEXT,
  ADD COLUMN "forceNextCandleDir"  TEXT;
