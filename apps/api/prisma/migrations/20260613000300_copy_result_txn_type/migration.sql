-- Copy Trading: novo tipo de transação para o resultado (ganho/perda) de uma
-- operação de copy liquidada. Aditivo e idempotente. Em migration própria
-- porque ALTER TYPE ADD VALUE não pode ter o novo valor usado na mesma
-- transação (o copyWorker usa 'COPY_RESULT'::"TransactionType").
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'COPY_RESULT';
