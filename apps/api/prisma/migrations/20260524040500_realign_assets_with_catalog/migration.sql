-- Realign the admin assets catalogue with the actual broker tradable list
-- (apps/web/src/lib/mockData.ts → ASSETS). The first seed used invented
-- symbol formats (EURUSD) that didn't match what users see on the trading
-- panel (EUR/JPY, BTC/USDT, etc.), so admins saw a list disjoint from what
-- they actually offer. This migration:
--   1. wipes the asset rows (no production payout customisations exist yet),
--   2. re-inserts the 84 assets the trading frontend actually exposes,
--      with stable ids that match the frontend's ASSET.id keys.
--
-- Note: TRUNCATE ... CASCADE is intentional — Operation/Withdrawal/etc.
-- reference accounts, not assets, so nothing downstream gets dropped.

TRUNCATE TABLE assets RESTART IDENTITY CASCADE;

INSERT INTO assets (id, symbol, name, category, payout, enabled, code1, code2, "marketSymbol", "displayOrder", "createdAt", "updatedAt") VALUES
  -- ── Forex / Mercado Aberto (real market hours) ────────────────────────
  ('eur-jpy',  'EUR/JPY', 'Euro / Iene',                     'OPEN_MARKET', 92, TRUE, 'eu', 'jp', NULL, 1,  NOW(), NOW()),
  ('usd-jpy',  'USD/JPY', 'Dólar / Iene',                    'OPEN_MARKET', 92, TRUE, 'us', 'jp', NULL, 2,  NOW(), NOW()),
  ('aud-jpy',  'AUD/JPY', 'Dólar Australiano / Iene',        'OPEN_MARKET', 91, TRUE, 'au', 'jp', NULL, 3,  NOW(), NOW()),
  ('aud-usd',  'AUD/USD', 'Dólar Australiano / Dólar',       'OPEN_MARKET', 89, TRUE, 'au', 'us', NULL, 4,  NOW(), NOW()),
  ('aud-chf',  'AUD/CHF', 'Dólar Australiano / Franco Suíço','OPEN_MARKET', 88, TRUE, 'au', 'ch', NULL, 5,  NOW(), NOW()),
  ('eur-gbp',  'EUR/GBP', 'Euro / Libra',                    'OPEN_MARKET', 87, TRUE, 'eu', 'gb', NULL, 6,  NOW(), NOW()),
  ('cad-jpy',  'CAD/JPY', 'Dólar Canadense / Iene',          'OPEN_MARKET', 85, TRUE, 'ca', 'jp', NULL, 7,  NOW(), NOW()),
  ('aud-cad',  'AUD/CAD', 'Dólar Australiano / Canadense',   'OPEN_MARKET', 84, TRUE, 'au', 'ca', NULL, 8,  NOW(), NOW()),
  ('gbp-usd',  'GBP/USD', 'Libra / Dólar',                   'OPEN_MARKET', 84, TRUE, 'gb', 'us', NULL, 9,  NOW(), NOW()),
  ('eur-usd',  'EUR/USD', 'Euro / Dólar',                    'OPEN_MARKET', 80, TRUE, 'eu', 'us', NULL, 10, NOW(), NOW()),
  ('gbp-aud',  'GBP/AUD', 'Libra / Dólar Australiano',       'OPEN_MARKET', 80, TRUE, 'gb', 'au', NULL, 11, NOW(), NOW()),
  ('usd-cad',  'USD/CAD', 'Dólar / Dólar Canadense',         'OPEN_MARKET', 79, TRUE, 'us', 'ca', NULL, 12, NOW(), NOW()),
  ('gbp-cad',  'GBP/CAD', 'Libra / Dólar Canadense',         'OPEN_MARKET', 78, TRUE, 'gb', 'ca', NULL, 13, NOW(), NOW()),
  -- commodities + index (Forex source but real market hours)
  ('silver',     'XAG/USD',    'Silver',           'OPEN_MARKET', 44, TRUE, 'us', 'us', NULL, 14, NOW(), NOW()),
  ('gold',       'XAU/USD',    'Gold',             'OPEN_MARKET', 44, TRUE, 'us', 'us', NULL, 15, NOW(), NOW()),
  ('asx200',     'S&P/ASX 200','S&P/ASX 200',      'OPEN_MARKET', 24, TRUE, 'au', 'us', NULL, 16, NOW(), NOW()),
  ('ftse-china', 'FTSE China A50','FTSE China A50 Index','OPEN_MARKET', 24, TRUE, 'cn', 'us', NULL, 17, NOW(), NOW()),

  -- ── OTC moedas (synthetic 24/7) ───────────────────────────────────────
  ('usd-brl-otc','USD/BRL','USD/BRL (OTC)','OTC', 95, TRUE, 'us', 'br', NULL, 30, NOW(), NOW()),
  ('eur-nzd-otc','EUR/NZD','EUR/NZD (OTC)','OTC', 95, TRUE, 'eu', 'nz', NULL, 31, NOW(), NOW()),
  ('aud-nzd-otc','AUD/NZD','AUD/NZD (OTC)','OTC', 95, TRUE, 'au', 'nz', NULL, 32, NOW(), NOW()),
  ('nzd-cad-otc','NZD/CAD','NZD/CAD (OTC)','OTC', 95, TRUE, 'nz', 'ca', NULL, 33, NOW(), NOW()),
  ('usd-dzd-otc','USD/DZD','USD/DZD (OTC)','OTC', 95, TRUE, 'us', 'dz', NULL, 34, NOW(), NOW()),
  ('usd-egp-otc','USD/EGP','USD/EGP (OTC)','OTC', 95, TRUE, 'us', 'eg', NULL, 35, NOW(), NOW()),
  ('nzd-chf-otc','NZD/CHF','NZD/CHF (OTC)','OTC', 94, TRUE, 'nz', 'ch', NULL, 36, NOW(), NOW()),
  ('usd-mxn-otc','USD/MXN','USD/MXN (OTC)','OTC', 92, TRUE, 'us', 'mx', NULL, 37, NOW(), NOW()),
  ('usd-cop-otc','USD/COP','USD/COP (OTC)','OTC', 90, TRUE, 'us', 'co', NULL, 38, NOW(), NOW()),
  ('usd-ngn-otc','USD/NGN','USD/NGN (OTC)','OTC', 89, TRUE, 'us', 'ng', NULL, 39, NOW(), NOW()),
  ('usd-inr-otc','USD/INR','USD/INR (OTC)','OTC', 88, TRUE, 'us', 'in', NULL, 40, NOW(), NOW()),
  ('usd-ars-otc','USD/ARS','USD/ARS (OTC)','OTC', 86, TRUE, 'us', 'ar', NULL, 41, NOW(), NOW()),
  ('cad-chf-otc','CAD/CHF','CAD/CHF (OTC)','OTC', 85, TRUE, 'ca', 'ch', NULL, 42, NOW(), NOW()),
  ('gbp-nzd-otc','GBP/NZD','GBP/NZD (OTC)','OTC', 83, TRUE, 'gb', 'nz', NULL, 43, NOW(), NOW()),
  ('eur-aud-otc','EUR/AUD','EUR/AUD (OTC)','OTC', 82, TRUE, 'eu', 'au', NULL, 44, NOW(), NOW()),
  ('gbp-chf-otc','GBP/CHF','GBP/CHF (OTC)','OTC', 80, TRUE, 'gb', 'ch', NULL, 45, NOW(), NOW()),
  ('usd-chf-otc','USD/CHF','USD/CHF (OTC)','OTC', 79, TRUE, 'us', 'ch', NULL, 46, NOW(), NOW()),
  ('eur-chf-otc','EUR/CHF','EUR/CHF (OTC)','OTC', 78, TRUE, 'eu', 'ch', NULL, 47, NOW(), NOW()),
  ('usd-sgd-otc','USD/SGD','USD/SGD (OTC)','OTC', 77, TRUE, 'us', 'sg', NULL, 48, NOW(), NOW()),
  ('usd-pln-otc','USD/PLN','USD/PLN (OTC)','OTC', 76, TRUE, 'us', 'pl', NULL, 49, NOW(), NOW()),

  -- ── OTC cripto (synthetic 24/7) ───────────────────────────────────────
  ('bch-otc',  'BCH/USD',  'Bitcoin Cash (OTC)',    'OTC', 95, TRUE, 'crypto:bch',   'us', NULL, 60, NOW(), NOW()),
  ('bnb-otc',  'BNB/USD',  'Binance Coin (OTC)',    'OTC', 95, TRUE, 'crypto:bnb',   'us', NULL, 61, NOW(), NOW()),
  ('etc-otc',  'ETC/USD',  'Ethereum Classic (OTC)','OTC', 95, TRUE, 'crypto:etc',   'us', NULL, 62, NOW(), NOW()),
  ('ltc-otc',  'LTC/USD',  'Litecoin (OTC)',        'OTC', 95, TRUE, 'crypto:ltc',   'us', NULL, 63, NOW(), NOW()),
  ('sol-otc',  'SOL/USD',  'Solana (OTC)',          'OTC', 95, TRUE, 'crypto:sol',   'us', NULL, 64, NOW(), NOW()),
  ('trump-otc','TRUMP/USD','Trump (OTC)',           'OTC', 95, TRUE, 'crypto:trump', 'us', NULL, 65, NOW(), NOW()),
  ('xrp-otc',  'XRP/USD',  'Ripple (OTC)',          'OTC', 95, TRUE, 'crypto:xrp',   'us', NULL, 66, NOW(), NOW()),
  ('zec-otc',  'ZEC/USD',  'Zcash (OTC)',           'OTC', 95, TRUE, 'crypto:zec',   'us', NULL, 67, NOW(), NOW()),
  ('atom-otc', 'ATOM/USD', 'Cosmos (OTC)',          'OTC', 93, TRUE, 'crypto:atom',  'us', NULL, 68, NOW(), NOW()),
  ('dash-otc', 'DASH/USD', 'Dash (OTC)',            'OTC', 90, TRUE, 'crypto:dash',  'us', NULL, 69, NOW(), NOW()),
  ('dot-otc',  'DOT/USD',  'Polkadot (OTC)',        'OTC', 90, TRUE, 'crypto:dot',   'us', NULL, 70, NOW(), NOW()),
  ('link-otc', 'LINK/USD', 'Chainlink (OTC)',       'OTC', 85, TRUE, 'crypto:link',  'us', NULL, 71, NOW(), NOW()),
  ('axs-otc',  'AXS/USD',  'Axie Infinity (OTC)',   'OTC', 82, TRUE, 'crypto:axs',   'us', NULL, 72, NOW(), NOW()),
  ('btc-otc',  'BTC/USD',  'Bitcoin (OTC)',         'OTC', 80, TRUE, 'crypto:btc',   'us', NULL, 73, NOW(), NOW()),
  ('eth-otc',  'ETH/USD',  'Ethereum (OTC)',        'OTC', 78, TRUE, 'crypto:eth',   'us', NULL, 74, NOW(), NOW()),
  ('ada-otc',  'ADA/USD',  'Cardano (OTC)',         'OTC', 75, TRUE, 'crypto:ada',   'us', NULL, 75, NOW(), NOW()),
  ('doge-otc', 'DOGE/USD', 'Dogecoin (OTC)',        'OTC', 72, TRUE, 'crypto:doge',  'us', NULL, 76, NOW(), NOW()),

  -- ── OTC commodities + stocks ──────────────────────────────────────────
  ('ukbrent-otc','UKBrent','UKBrent (OTC)','OTC', 86, TRUE, 'gb', 'us', NULL, 90, NOW(), NOW()),
  ('uscrude-otc','USCrude','USCrude (OTC)','OTC', 85, TRUE, 'us', 'us', NULL, 91, NOW(), NOW()),
  ('jnj-otc',  'JNJ',  'Johnson & Johnson (OTC)','OTC', 95, TRUE, 'us', 'us', NULL, 100, NOW(), NOW()),
  ('intc-otc', 'INTC', 'Intel (OTC)',            'OTC', 90, TRUE, 'us', 'us', NULL, 101, NOW(), NOW()),
  ('msft-otc', 'MSFT', 'Microsoft (OTC)',        'OTC', 90, TRUE, 'us', 'us', NULL, 102, NOW(), NOW()),
  ('ba-otc',   'BA',   'Boeing Company (OTC)',   'OTC', 89, TRUE, 'us', 'us', NULL, 103, NOW(), NOW()),
  ('meta-otc', 'META', 'FACEBOOK INC (OTC)',     'OTC', 87, TRUE, 'us', 'us', NULL, 104, NOW(), NOW()),
  ('pfe-otc',  'PFE',  'Pfizer Inc (OTC)',       'OTC', 87, TRUE, 'us', 'us', NULL, 105, NOW(), NOW()),
  ('mcd-otc',  'MCD',  'McDonald''s (OTC)',      'OTC', 82, TRUE, 'us', 'us', NULL, 106, NOW(), NOW()),
  ('axp-otc',  'AXP',  'American Express (OTC)', 'OTC', 81, TRUE, 'us', 'us', NULL, 107, NOW(), NOW()),
  ('aapl-otc', 'AAPL', 'Apple Inc (OTC)',        'OTC', 80, TRUE, 'us', 'us', NULL, 108, NOW(), NOW()),
  ('googl-otc','GOOGL','Google (OTC)',           'OTC', 79, TRUE, 'us', 'us', NULL, 109, NOW(), NOW()),
  ('amzn-otc', 'AMZN', 'Amazon (OTC)',           'OTC', 78, TRUE, 'us', 'us', NULL, 110, NOW(), NOW()),
  ('tsla-otc', 'TSLA', 'Tesla (OTC)',            'OTC', 76, TRUE, 'us', 'us', NULL, 111, NOW(), NOW()),

  -- ── Crypto (live Binance pricing) ─────────────────────────────────────
  ('btc-usdt-binance', 'BTC/USDT', 'Bitcoin / USDT',    'CRYPTO', 95, TRUE, 'crypto:btc',  'us', 'BTCUSDT',  150, NOW(), NOW()),
  ('eth-usdt-binance', 'ETH/USDT', 'Ethereum / USDT',   'CRYPTO', 95, TRUE, 'crypto:eth',  'us', 'ETHUSDT',  151, NOW(), NOW()),
  ('bnb-usdt-binance', 'BNB/USDT', 'BNB / USDT',        'CRYPTO', 95, TRUE, 'crypto:bnb',  'us', 'BNBUSDT',  152, NOW(), NOW()),
  ('sol-usdt-binance', 'SOL/USDT', 'Solana / USDT',     'CRYPTO', 95, TRUE, 'crypto:sol',  'us', 'SOLUSDT',  153, NOW(), NOW()),
  ('xrp-usdt-binance', 'XRP/USDT', 'Ripple / USDT',     'CRYPTO', 95, TRUE, 'crypto:xrp',  'us', 'XRPUSDT',  154, NOW(), NOW()),
  ('ada-usdt-binance', 'ADA/USDT', 'Cardano / USDT',    'CRYPTO', 94, TRUE, 'crypto:ada',  'us', 'ADAUSDT',  155, NOW(), NOW()),
  ('doge-usdt-binance','DOGE/USDT','Dogecoin / USDT',   'CRYPTO', 94, TRUE, 'crypto:doge', 'us', 'DOGEUSDT', 156, NOW(), NOW()),
  ('ltc-usdt-binance', 'LTC/USDT', 'Litecoin / USDT',   'CRYPTO', 94, TRUE, 'crypto:ltc',  'us', 'LTCUSDT',  157, NOW(), NOW()),
  ('dot-usdt-binance', 'DOT/USDT', 'Polkadot / USDT',   'CRYPTO', 93, TRUE, 'crypto:dot',  'us', 'DOTUSDT',  158, NOW(), NOW()),
  ('link-usdt-binance','LINK/USDT','Chainlink / USDT',  'CRYPTO', 93, TRUE, 'crypto:link', 'us', 'LINKUSDT', 159, NOW(), NOW()),
  ('bch-usdt-binance', 'BCH/USDT', 'Bitcoin Cash / USDT','CRYPTO', 93, TRUE, 'crypto:bch',  'us', 'BCHUSDT',  160, NOW(), NOW()),
  ('avax-usdt-binance','AVAX/USDT','Avalanche / USDT',  'CRYPTO', 92, TRUE, 'crypto:avax', 'us', 'AVAXUSDT', 161, NOW(), NOW()),
  ('trx-usdt-binance', 'TRX/USDT', 'TRON / USDT',       'CRYPTO', 92, TRUE, 'crypto:trx',  'us', 'TRXUSDT',  162, NOW(), NOW()),
  ('ton-usdt-binance', 'TON/USDT', 'Toncoin / USDT',    'CRYPTO', 92, TRUE, 'crypto:ton',  'us', 'TONUSDT',  163, NOW(), NOW()),
  ('shib-usdt-binance','SHIB/USDT','Shiba Inu / USDT',  'CRYPTO', 91, TRUE, 'crypto:shib', 'us', 'SHIBUSDT', 164, NOW(), NOW()),
  ('pepe-usdt-binance','PEPE/USDT','Pepe / USDT',       'CRYPTO', 90, TRUE, 'crypto:pepe', 'us', 'PEPEUSDT', 165, NOW(), NOW()),
  ('sui-usdt-binance', 'SUI/USDT', 'Sui / USDT',        'CRYPTO', 90, TRUE, 'crypto:sui',  'us', 'SUIUSDT',  166, NOW(), NOW());
