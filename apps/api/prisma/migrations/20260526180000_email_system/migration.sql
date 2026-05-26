-- Email system tables: admin-editable templates + password reset tokens.
-- See prisma/schema.prisma EmailTemplate + PasswordResetToken models.

CREATE TABLE "email_templates" (
    "key"         TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subject"     TEXT NOT NULL,
    "htmlBody"    TEXT NOT NULL,
    "variables"   TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active"      BOOLEAN NOT NULL DEFAULT true,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "password_reset_tokens" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "usedAt"     TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the 11 default templates with Vx Global branding. Each htmlBody is
-- a self-contained HTML doc so opening in any email client (Gmail, Outlook,
-- Apple Mail, Thunderbird) renders consistently. Inline styles only —
-- email clients strip <style> blocks aggressively.
INSERT INTO "email_templates" ("key", "name", "description", "subject", "htmlBody", "variables", "active", "updatedAt") VALUES

('WELCOME',
 'Boas-vindas',
 'Enviado após o cadastro do usuário',
 'Bem-vindo à Vx Global!',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#fff;font-size:22px;margin:0 0 16px 0">Olá, {{name}}!</h2><p style="margin:0 0 16px 0">Sua conta na <strong style="color:#fff">Vx Global</strong> foi criada com sucesso. Já está tudo pronto pra você começar a operar.</p><p style="margin:0 0 24px 0">Você já tem <strong style="color:#10b981">R$ 10.000,00 de saldo demo</strong> pra testar sem risco antes de operar com dinheiro real.</p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#2563eb;border-radius:8px"><a href="https://vx-global.com" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:bold;font-size:15px">Acessar a plataforma</a></td></tr></table><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Bom trade!<br>Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name'],
 true,
 NOW()),

('PASSWORD_RESET',
 'Recuperação de Senha',
 'Enviado quando o usuário solicita recuperação de senha',
 'Recupere sua senha - Vx Global',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#fff;font-size:22px;margin:0 0 16px 0">Olá, {{name}}</h2><p style="margin:0 0 16px 0">Recebemos um pedido para redefinir a senha da sua conta na Vx Global. Clique no botão abaixo para criar uma nova senha:</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="background:#2563eb;border-radius:8px"><a href="{{reset_link}}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:bold;font-size:15px">Redefinir minha senha</a></td></tr></table><p style="margin:0 0 8px 0;color:#8b8f9a;font-size:13px">Este link expira em <strong style="color:#fff">1 hora</strong>.</p><p style="margin:0;color:#8b8f9a;font-size:13px">Se você não solicitou essa redefinição, ignore este email — sua senha não muda enquanto o link não for usado.</p><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name', 'reset_link'],
 true,
 NOW()),

('DEPOSIT_CONFIRMED',
 'Depósito Confirmado',
 'Enviado quando um depósito é confirmado pelo gateway',
 'Seu depósito foi confirmado',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#10b981;font-size:22px;margin:0 0 16px 0">Depósito confirmado!</h2><p style="margin:0 0 16px 0">Olá <strong style="color:#fff">{{name}}</strong>, seu depósito de <strong style="color:#10b981">R$ {{amount}}</strong> foi creditado na sua conta REAL.</p><p style="margin:0 0 24px 0">Você já pode começar a operar.</p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#2563eb;border-radius:8px"><a href="https://vx-global.com" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:bold;font-size:15px">Operar agora</a></td></tr></table><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name', 'amount'],
 true,
 NOW()),

('WITHDRAWAL_APPROVED',
 'Saque Aprovado',
 'Enviado quando um saque é aprovado pelo admin',
 'Seu saque foi aprovado',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#10b981;font-size:22px;margin:0 0 16px 0">Saque aprovado</h2><p style="margin:0 0 16px 0">Olá <strong style="color:#fff">{{name}}</strong>, seu saque de <strong style="color:#10b981">R$ {{amount}}</strong> foi aprovado e será processado em breve.</p><p style="margin:0 0 24px 0;color:#8b8f9a;font-size:13px">PIX cai na conta cadastrada em até 1 dia útil.</p><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name', 'amount'],
 true,
 NOW()),

('WITHDRAWAL_REJECTED',
 'Saque Rejeitado',
 'Enviado quando um saque é rejeitado pelo admin',
 'Sobre seu pedido de saque',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#ef4444;font-size:22px;margin:0 0 16px 0">Saque não aprovado</h2><p style="margin:0 0 16px 0">Olá <strong style="color:#fff">{{name}}</strong>, seu pedido de saque de <strong>R$ {{amount}}</strong> não pôde ser processado.</p><p style="margin:0 0 16px 0">Motivo: <em style="color:#fbbf24">{{reason}}</em></p><p style="margin:0 0 16px 0">O valor foi devolvido ao seu saldo. Em caso de dúvida, entre em contato pelo suporte.</p><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name', 'amount', 'reason'],
 true,
 NOW()),

('KYC_APPROVED',
 'KYC Aprovado',
 'Enviado quando os documentos do usuário são aprovados',
 'Sua conta foi verificada com sucesso',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#10b981;font-size:22px;margin:0 0 16px 0">✓ Conta verificada</h2><p style="margin:0 0 16px 0">Parabéns <strong style="color:#fff">{{name}}</strong>! Seus documentos foram aprovados.</p><p style="margin:0 0 24px 0">Sua conta agora tem todos os limites liberados — depósitos e saques sem restrição.</p><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name'],
 true,
 NOW()),

('KYC_REJECTED',
 'KYC Rejeitado',
 'Enviado quando os documentos do usuário são rejeitados',
 'Sobre a verificação dos seus documentos',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#fbbf24;font-size:22px;margin:0 0 16px 0">Verificação não aprovada</h2><p style="margin:0 0 16px 0">Olá <strong style="color:#fff">{{name}}</strong>, não conseguimos aprovar seus documentos.</p><p style="margin:0 0 16px 0">Motivo: <em style="color:#fbbf24">{{reason}}</em></p><p style="margin:0 0 24px 0">Acesse sua conta para reenviar com fotos mais nítidas e do mesmo documento atualizado.</p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#2563eb;border-radius:8px"><a href="https://vx-global.com" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:bold;font-size:15px">Reenviar documentos</a></td></tr></table><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name', 'reason'],
 true,
 NOW()),

('TICKET_REPLIED',
 'Ticket Respondido',
 'Enviado quando o suporte responde a um ticket',
 'Você tem uma nova resposta do suporte',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px 32px 16px 32px;text-align:center"><h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1></td></tr><tr><td style="padding:0 32px 32px 32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#fff;font-size:22px;margin:0 0 16px 0">Olá, {{name}}</h2><p style="margin:0 0 8px 0;color:#8b8f9a;font-size:13px">Ticket:</p><p style="margin:0 0 16px 0;color:#fff;font-weight:bold">{{ticket_subject}}</p><div style="background:#222637;border-left:3px solid #2563eb;border-radius:4px;padding:14px 16px;margin:16px 0;color:#e5e7eb;line-height:1.6">{{message}}</div><table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr><td style="background:#2563eb;border-radius:8px"><a href="https://vx-global.com" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:bold;font-size:15px">Ver ticket</a></td></tr></table><p style="margin:32px 0 0 0;color:#8b8f9a;font-size:13px">Equipe Vx Global</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['name', 'ticket_subject', 'message'],
 true,
 NOW()),

('EMAIL_TEST',
 'Email de Teste',
 'Template usado pelo botão "Testar" no painel admin',
 'Email de teste - Vx Global',
 E'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:100%;background:#161b27;border-radius:12px;overflow:hidden"><tr><td style="padding:32px;color:#e5e7eb;font-size:15px;line-height:1.6"><h2 style="color:#10b981;font-size:22px;margin:0 0 16px 0">✓ Sistema de email funcionando</h2><p style="margin:0">Se você está vendo este email, a configuração SMTP está OK. Disparo feito em {{timestamp}}.</p></td></tr></table></td></tr></table></body></html>',
 ARRAY['timestamp'],
 true,
 NOW());
