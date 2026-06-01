-- "Lembrar este dispositivo" pro step-up 2FA do admin.
-- Apos validar o codigo 2FA, o backend emite um token random (32 bytes)
-- e salva o HASH na tabela. Token vive num cookie httpOnly samesite=strict
-- por 30 dias. Em proximos acessos a /admin/*, o frontend tenta primeiro
-- o /auth/admin-step-up-trusted (le o cookie); se valido, emite JWT com
-- adminAuth=true automaticamente, sem pedir o codigo.

CREATE TABLE "admin_trusted_devices" (
  "id"          TEXT          NOT NULL,
  "userId"      TEXT          NOT NULL,
  "tokenHash"   TEXT          NOT NULL,
  "userAgent"   TEXT,
  "ip"          TEXT,
  "lastUsedAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMPTZ(3) NOT NULL,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"   TIMESTAMPTZ(3),
  CONSTRAINT "admin_trusted_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_trusted_devices_tokenHash_key" ON "admin_trusted_devices"("tokenHash");
CREATE INDEX "admin_trusted_devices_userId_idx"     ON "admin_trusted_devices"("userId");
CREATE INDEX "admin_trusted_devices_expiresAt_idx"  ON "admin_trusted_devices"("expiresAt");

ALTER TABLE "admin_trusted_devices"
  ADD CONSTRAINT "admin_trusted_devices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
