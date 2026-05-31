-- B1.1: Audit log generico de todas as admin actions.
--
-- Antes desta tabela so' o OTC tinha rastro (otc_admin_logs). Tudo o
-- resto do painel admin (withdrawals approve, users block, deposits
-- mark-paid, etc) executava sem deixar registro. Impossivel investigar
-- fraude/erro depois.
--
-- Modelo generico: resourceType + resourceId + action + before/after.
-- Funciona pra QUALQUER recurso futuro sem precisar de migration nova.

CREATE TABLE "admin_audit_log" (
  "id"           BIGSERIAL    NOT NULL,
  "resourceType" TEXT         NOT NULL,
  "resourceId"   TEXT,
  "action"       TEXT         NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "adminId"      TEXT         NOT NULL,
  "ip"           TEXT,
  "userAgent"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- Index pra timeline reversa (pagina de audit abre mostrando mais recente)
CREATE INDEX "admin_audit_log_createdAt_idx"
  ON "admin_audit_log" ("createdAt" DESC);

-- Index pra historico de UM recurso (ex: "todas as acoes neste usuario").
-- resourceId nullable mas isso e' OK no btree.
CREATE INDEX "admin_audit_log_resource_idx"
  ON "admin_audit_log" ("resourceType", "resourceId", "createdAt" DESC);

-- Index pra auditoria de UM admin especifico (ex: "tudo que esse admin fez").
CREATE INDEX "admin_audit_log_admin_idx"
  ON "admin_audit_log" ("adminId", "createdAt" DESC);
