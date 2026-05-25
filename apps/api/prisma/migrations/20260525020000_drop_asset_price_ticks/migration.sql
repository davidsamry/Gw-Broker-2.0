-- Etapa 8 cleanup — drop the legacy OTC v1 tick table. Nothing reads
-- it anymore: the v1 worker is removed, the operations worker dropped
-- its `fetchLatestOtcTick` fallback, the legacy /otc/ routes are gone.
-- otc_ticks (v2) is the sole source of OTC tick data going forward.

DROP TABLE IF EXISTS asset_price_ticks;
