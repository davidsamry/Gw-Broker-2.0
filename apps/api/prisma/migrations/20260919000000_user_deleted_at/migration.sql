-- "Excluir minha conta" pelo próprio usuário. Exclusão SOFT: marca a data
-- e passa a negar login/refresh. Nenhuma linha é apagada — depósitos,
-- operações e saques continuam visíveis no admin.
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
