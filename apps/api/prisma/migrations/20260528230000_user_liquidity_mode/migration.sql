-- Per-user "liquidez" flag. When TRUE, the operations resolver forces a
-- LOSS on 70% of this user's resolutions, regardless of the actual price
-- comparison. Default FALSE so existing users + every new signup is
-- unaffected — admin opts a single user in via /admin/usuarios drawer.
--
-- The 70% is applied at resolution time (each op rolls independently),
-- so the long-run loss rate converges to 70% but day-to-day variance is
-- natural. No batched scheduling, no cross-user state.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "liquidityMode" BOOLEAN NOT NULL DEFAULT FALSE;
