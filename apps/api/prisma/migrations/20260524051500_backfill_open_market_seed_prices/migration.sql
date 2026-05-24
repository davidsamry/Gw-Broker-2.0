-- Backfill seedPrice for OPEN_MARKET assets so the OTC pricing worker
-- ticks them too. Etapa 2's backfill covered only OTC rows, leaving the
-- 17 forex / commodity / index entries with seedPrice NULL → the worker
-- skipped them → chart had no live ticks → trade entry fell back to the
-- static mockData price (e.g. AUD/USD at 0.6612), landing the marker
-- far from where the user clicked.
--
-- Pricing engine is the same as OTC: random walk with mean reversion to
-- seedPrice + 0.0005 volatility. "Mercado Aberto" stays as the UI label
-- (different chip colour, different category filter), but the engine is
-- unified. Future work: swap to a real feed (Twelve Data) for these
-- specific rows by adding a marketSymbol + source flag — the worker
-- will then skip them just like it skips Binance rows.
--
-- Heads-up: API needs to restart (or admin needs to POST
-- /admin/assets/otc-reload) for the worker to pick these new rows into
-- its in-memory cache.

-- Forex pairs
UPDATE assets SET "seedPrice" = 170.54000 WHERE id = 'eur-jpy';
UPDATE assets SET "seedPrice" = 158.92000 WHERE id = 'usd-jpy';
UPDATE assets SET "seedPrice" = 104.23000 WHERE id = 'aud-jpy';
UPDATE assets SET "seedPrice" =   0.66120 WHERE id = 'aud-usd';
UPDATE assets SET "seedPrice" =   0.58910 WHERE id = 'aud-chf';
UPDATE assets SET "seedPrice" =   0.85210 WHERE id = 'eur-gbp';
UPDATE assets SET "seedPrice" = 116.78000 WHERE id = 'cad-jpy';
UPDATE assets SET "seedPrice" =   0.90210 WHERE id = 'aud-cad';
UPDATE assets SET "seedPrice" =   1.27340 WHERE id = 'gbp-usd';
UPDATE assets SET "seedPrice" =   1.08540 WHERE id = 'eur-usd';
UPDATE assets SET "seedPrice" =   1.92650 WHERE id = 'gbp-aud';
UPDATE assets SET "seedPrice" =   1.36210 WHERE id = 'usd-cad';
UPDATE assets SET "seedPrice" =   1.73410 WHERE id = 'gbp-cad';

-- Commodities (Silver / Gold)
UPDATE assets SET "seedPrice" =   31.42000 WHERE id = 'silver';
UPDATE assets SET "seedPrice" = 2345.80000 WHERE id = 'gold';

-- Indexes (ASX200 / FTSE China A50). Larger nominal prices, default
-- volatility 0.0005 gives ticks of ~4pt for ASX (7821 * 0.0005) and
-- ~6.7pt for FTSE China — feels right for "real" market behaviour.
UPDATE assets SET "seedPrice" =  7821.30000 WHERE id = 'asx200';
UPDATE assets SET "seedPrice" = 13421.00000 WHERE id = 'ftse-china';
