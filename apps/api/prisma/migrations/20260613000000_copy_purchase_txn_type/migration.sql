-- Copy Trading: novo tipo de transação para compra de Copy Trader pago.
-- Aditivo e idempotente. Separado das tabelas (migration própria) porque
-- ALTER TYPE ADD VALUE não pode ter o novo valor usado na mesma transação.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'COPY_PURCHASE';
