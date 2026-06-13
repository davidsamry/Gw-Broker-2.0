-- Auto-Liquidez: gatilho alternativo por % do rollover atingido (OR com o
-- gatilho de lucro). Default 50 = ativa quando rolloverProgress >= 50% do
-- rolloverRequired, mesmo sem atingir o lucro. Aditivo e idempotente.
ALTER TABLE "platform_settings"
  ADD COLUMN IF NOT EXISTS "autoLiquidityRolloverPct" INTEGER NOT NULL DEFAULT 50;
