-- Bot API — opaque refresh tokens stored as SHA-256 hashes.
--
-- The Bot API issues JWT access tokens (1h) and opaque refresh tokens
-- (30d). Storing only the hash means a DB leak doesn't compromise
-- live sessions; rotating a token revokes the old one server-side
-- (vs JWT-only refresh, which we'd have no way to invalidate).
--
-- One row per refresh token. On /bot/v1/refresh we:
--   1) hash the incoming token, look it up
--   2) check expiresAt + revokedAt
--   3) issue a new pair, set revokedAt=NOW on the old one (rotation)
--   4) write a new row for the new refresh token

CREATE TABLE "bot_refresh_tokens" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "tokenHash"   TEXT NOT NULL,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "revokedAt"   TIMESTAMP(3),
    "lastUsedAt"  TIMESTAMP(3),
    "ip"          TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_refresh_tokens_tokenHash_key" ON "bot_refresh_tokens"("tokenHash");
CREATE INDEX "bot_refresh_tokens_userId_idx" ON "bot_refresh_tokens"("userId");
CREATE INDEX "bot_refresh_tokens_expiresAt_idx" ON "bot_refresh_tokens"("expiresAt");

ALTER TABLE "bot_refresh_tokens"
    ADD CONSTRAINT "bot_refresh_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
