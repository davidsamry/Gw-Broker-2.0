-- Campos especificos pra depositos crypto (USDT/BTC/etc via BSPay).
-- Null pra deposits PIX existentes. Preenchidos quando method=CRYPTO.
--
-- 2026-06-04: USDT TRC20 (e demais cryptos) usam o mesmo endpoint
-- POST /v2/transactions/cashin da BSPay com currency=USDT, chain=tron.
-- O retorno e' um endereco de wallet (nao QR PIX). User envia USDT
-- pra esse endereco, BSPay detecta on-chain e dispara webhook
-- cashin.confirmed com tx_hash + from_address.

ALTER TABLE "deposits"
  ADD COLUMN "cryptoNetwork"  TEXT,
  ADD COLUMN "cryptoCurrency" TEXT,
  ADD COLUMN "cryptoAddress"  TEXT,
  ADD COLUMN "cryptoAmount"   DECIMAL(18, 8),
  ADD COLUMN "cryptoTxHash"   TEXT,
  ADD COLUMN "cryptoFromAddr" TEXT;

-- Index pra lookup rapido pelo tx_hash no webhook (caso BSPay so' mande
-- isso e a gente precise localizar o deposit pra completar).
CREATE INDEX "deposits_cryptoTxHash_idx" ON "deposits"("cryptoTxHash");
