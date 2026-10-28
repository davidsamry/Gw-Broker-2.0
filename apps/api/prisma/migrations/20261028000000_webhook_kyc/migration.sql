-- Webhook de envio de documentação KYC. Mesma tabela e mesmo mecanismo
-- dos outros três eventos — só mais uma chave canônica.
--
-- Entra DESLIGADO com url vazia, igual aos demais: o admin configura a
-- URL e ativa em /admin/webhooks. ON CONFLICT deixa a migration
-- re-executável.
INSERT INTO "webhook_configs" ("id", "key", "url", "active", "createdAt", "updatedAt")
VALUES ('whc_kyc_submitted', 'KYC_SUBMITTED', '', FALSE, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
