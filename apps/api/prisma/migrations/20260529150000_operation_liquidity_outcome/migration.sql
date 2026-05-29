-- Persist the per-op liquidity-cycle outcome on the row itself instead
-- of an in-memory Set. Without persistence, ANY restart (deploy, OOM,
-- crash, tsx hot-reload in dev) between createOperation and the worker
-- resolving the op silently drops the marker → the op resolves
-- naturally, breaking the 7L+3W guarantee for any user with liquidity
-- mode enabled.
--
-- Values:
--   NULL  → not a liquidity-cycle op (normal user OR DEMO account OR
--           liquidityMode=false). Worker resolves by price as usual.
--   'WIN' → cycle picked WIN at OPEN time. Worker forces WON.
--   'LOSS'→ cycle picked LOSS at OPEN time. Worker forces LOST.
--
-- The column is plain TEXT (no enum) to keep the migration trivial and
-- the value space documented in code, not in DDL. Backfill not needed —
-- existing rows stay NULL and resolve normally.

ALTER TABLE "operations"
  ADD COLUMN IF NOT EXISTS "liquidityOutcome" TEXT;
