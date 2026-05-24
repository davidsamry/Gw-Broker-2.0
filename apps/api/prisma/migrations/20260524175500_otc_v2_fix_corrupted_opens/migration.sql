-- One-off cleanup: clamp openPrice to [lowPrice, highPrice] for any
-- otc_candles row where the OHLC invariant is broken.
--
-- Cause: the previous flushPending ON CONFLICT clause updated h/l/c on
-- re-insert but NOT openPrice. A re-seeded CandleBuilder (after restart)
-- would write fresh h/l/c values over an orphan openPrice from a prior
-- run, producing rows with open > high or open < low.
--
-- Fix in app code: ON CONFLICT now also updates openPrice (see worker.ts
-- flushPending). This migration heals the historical rows that already
-- got corrupted before the code fix shipped.
--
-- Clamping (vs setting to NULL or deleting):
--   • LEAST(open, high) caps an open that was above the actual high.
--   • GREATEST(…, low) lifts an open that was below the actual low.
--   • If the candle was already consistent, the value doesn't change.
--
-- Result: the candle's body never extends beyond its wick, which is the
-- structural guarantee TradingView assumes when rendering.

UPDATE otc_candles
   SET "openPrice" = GREATEST("lowPrice", LEAST("openPrice", "highPrice"))
 WHERE "openPrice" > "highPrice" OR "openPrice" < "lowPrice";
