-- "Excluir minha conta" pelo próprio usuário. Exclusão SOFT: marca a data
-- e passa a negar login/refresh. Nenhuma linha é apagada — depósitos,
-- operações e saques continuam visíveis no admin.
--
-- deletedBalance guarda o saldo REAL que havia na hora (o saldo em si é
-- zerado, com lançamento ADJUSTMENT no extrato pra manter o rastro).
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deletedBalance" DECIMAL(18,2);
