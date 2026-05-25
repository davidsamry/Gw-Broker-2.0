-- OTC Refactor — full recalibration after observed runaway.
--
-- Symptom observed in prod (post-Fase 5 deploy):
--   EUR/USD ranged 0.54 → 1.74 (seed 1.085) — 3.2× span between min/max
--   BTC/USD touched 34001 (=seedPrice × 0.5, the catastrophic clamp floor)
--   GOLD ranged 2110 → 4650 (seed 2350) — 2.2× span
-- Cause: the 20260524191500_otc_v2_bump_volatility_2x migration doubled
-- volatilityBase to "make LATERAL stretches less boring", but Fase 5
-- (naturalidade dos candles) later added session multipliers (1.4× NY
-- session), pullback FSM, micro pullbacks, counter-trend spike bias and
-- a stronger liquidity bias weight. With all those compounding on top
-- of the 2× volatility bump, effective per-tick stddev under HIGH_VOL +
-- NY + high volume reaches volatilityBase × 1.4 × 2.0 × 1.4 ≈ 4× — and
-- the reversion term (-0.0002 × distance/seed) is too weak to overcome
-- a STRONG regime trend chain compounded over hours.
--
-- Fix: this migration alone doesn't change the engine code (separate
-- commit halves volatility AND bumps reversion 0.0002 → 0.0004). What
-- this migration does on the DB side:
--
--   1. UPDATE otc_assets.volatilityBase back to the realistic_volatility
--      values (pre-2× bump). Combined with the in-code reversion bump,
--      the engine should sit within ±5% of seed for FX/commodity and
--      ±10% for crypto under sustained operation.
--   2. TRUNCATE otc_candles — user already wiped this manually but a
--      fresh deploy needs to be safe even if state is reintroduced.
--   3. TRUNCATE otc_engine_snapshot — the Fase 3 deterministic snapshot.
--      Without this, the engine would restart at the runaway price on
--      the next boot. Empty snapshot triggers the fall-through chain
--      in buildInitialState: snapshot → tick → candle → seedPrice.
--   4. TRUNCATE otc_ticks — purges the bad-price ticks that would
--      otherwise become the tick-fallback during recovery. Operations
--      store entryPrice/exitPrice directly on the row so historical
--      audit isn't lost.
--   5. RESET otc_market_state to LATERAL regime + neutral.
--   6. RESET otc_liquidity_state to neutral defaults.
--
-- Net effect after deploy: engine boots fresh, every asset starts at
-- its seedPrice in LATERAL regime, the new (calmer) volatility +
-- (stronger) reversion keep prices anchored without making the chart
-- feel rubber-banded.

-- 1. Recalibrate volatility back to the realistic_volatility baseline.
UPDATE otc_assets SET "volatilityBase" = 0.00010 WHERE id = 'eur-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00015 WHERE id = 'gbp-jpy-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00040 WHERE id = 'btc-usd-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00012 WHERE id = 'gold-otc';
UPDATE otc_assets SET "volatilityBase" = 0.00010 WHERE id = 'nasdaq-otc';

-- 2-4. Wipe transient pricing state. TRUNCATE rather than DELETE for
-- speed (no per-row triggers, no WAL bloat, identity reset implicit
-- where SERIAL columns exist).
TRUNCATE TABLE otc_candles         RESTART IDENTITY;
TRUNCATE TABLE otc_ticks           RESTART IDENTITY;
TRUNCATE TABLE otc_engine_snapshot;

-- 5. Reset the legacy market state to LATERAL / neutral. UPDATE rather
-- than TRUNCATE because this is a 1-row-per-asset table with FK to
-- otc_assets and the bootstrap seed insert is idempotent — overwriting
-- in place is cleaner than re-seeding.
UPDATE otc_market_state SET
  "currentRegime"   = 'LATERAL'::"OtcRegime",
  "regimeStartedAt" = NOW(),
  "regimeDurationS" = 60,
  "currentDrift"    = 0,
  "currentVol"      = (SELECT "volatilityBase" FROM otc_assets WHERE otc_assets.id = otc_market_state."assetId"),
  "trendBias"       = 0,
  "updatedAt"       = NOW();

-- 6. Reset legacy liquidity state to the same defaults the schema uses.
UPDATE otc_liquidity_state SET
  spread         = 0.0001,
  "buyPressure"  = 0.5,
  "sellPressure" = 0.5,
  volume         = 1.0,
  depth          = 1.0,
  speed          = 1.0,
  "updatedAt"    = NOW();
