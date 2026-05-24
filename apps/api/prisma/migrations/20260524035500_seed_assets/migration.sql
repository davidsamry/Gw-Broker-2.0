-- Seed the initial asset catalogue. Idempotent: ON CONFLICT DO NOTHING
-- means re-running this (e.g. on a fresh clone) won't dupe rows, and a
-- prod deploy can apply it once without complaint.
--
-- Categories: OPEN_MARKET = forex pairs (real market hours), OTC = synthetic
-- 24/7 pairs, CRYPTO = spot crypto. The 50 entries below mirror the launch
-- catalogue the admin manages from /admin/ativos.

INSERT INTO assets (id, symbol, name, category, payout, enabled, code1, code2, "marketSymbol", "displayOrder", "createdAt", "updatedAt") VALUES
  -- ── Forex / Mercado Aberto ──────────────────────────────────────────────
  ('asset_eurusd',  'EURUSD', 'Euro / Dólar',                       'OPEN_MARKET', 85, TRUE, 'eu','us', NULL,         1,  NOW(), NOW()),
  ('asset_eurgbp',  'EURGBP', 'Euro / Libra',                       'OPEN_MARKET', 85, TRUE, 'eu','gb', NULL,         2,  NOW(), NOW()),
  ('asset_eurjpy',  'EURJPY', 'Euro / Iene',                        'OPEN_MARKET', 85, TRUE, 'eu','jp', NULL,         3,  NOW(), NOW()),
  ('asset_usdjpy',  'USDJPY', 'Dólar / Iene',                       'OPEN_MARKET', 85, TRUE, 'us','jp', NULL,         4,  NOW(), NOW()),
  ('asset_gbpjpy',  'GBPJPY', 'Libra / Iene',                       'OPEN_MARKET', 85, TRUE, 'gb','jp', NULL,         5,  NOW(), NOW()),
  ('asset_gbpusd',  'GBPUSD', 'Libra / Dólar',                      'OPEN_MARKET', 85, TRUE, 'gb','us', NULL,         6,  NOW(), NOW()),
  ('asset_audcad',  'AUDCAD', 'Dólar Australiano / Dólar Canadense','OPEN_MARKET', 85, TRUE, 'au','ca', NULL,         7,  NOW(), NOW()),
  ('asset_audjpy',  'AUDJPY', 'Dólar Australiano / Iene',           'OPEN_MARKET', 85, TRUE, 'au','jp', NULL,         8,  NOW(), NOW()),
  ('asset_euraud',  'EURAUD', 'Euro / Dólar Australiano',           'OPEN_MARKET', 85, TRUE, 'eu','au', NULL,         9,  NOW(), NOW()),
  ('asset_eurchf',  'EURCHF', 'Euro / Franco Suíço',                'OPEN_MARKET', 85, TRUE, 'eu','ch', NULL,         10, NOW(), NOW()),
  ('asset_gbpaud',  'GBPAUD', 'Libra / Dólar Australiano',          'OPEN_MARKET', 85, TRUE, 'gb','au', NULL,         11, NOW(), NOW()),
  ('asset_gbpnzd',  'GBPNZD', 'Libra / Dólar Neozelandês',          'OPEN_MARKET', 85, TRUE, 'gb','nz', NULL,         12, NOW(), NOW()),
  ('asset_nzdcad',  'NZDCAD', 'Dólar Neozelandês / Dólar Canadense','OPEN_MARKET', 85, TRUE, 'nz','ca', NULL,         13, NOW(), NOW()),
  ('asset_usdcad',  'USDCAD', 'Dólar / Dólar Canadense',            'OPEN_MARKET', 85, TRUE, 'us','ca', NULL,         14, NOW(), NOW()),
  ('asset_usdchf',  'USDCHF', 'Dólar / Franco Suíço',               'OPEN_MARKET', 85, TRUE, 'us','ch', NULL,         15, NOW(), NOW()),
  ('asset_audusd',  'AUDUSD', 'Dólar Australiano / Dólar',          'OPEN_MARKET', 85, TRUE, 'au','us', NULL,         16, NOW(), NOW()),
  ('asset_audchf',  'AUDCHF', 'Dólar Australiano / Franco Suíço',   'OPEN_MARKET', 85, TRUE, 'au','ch', NULL,         17, NOW(), NOW()),
  ('asset_audnzd',  'AUDNZD', 'Dólar Australiano / Dólar Neozelandês','OPEN_MARKET',85,TRUE,'au','nz', NULL,          18, NOW(), NOW()),
  ('asset_nzdjpy',  'NZDJPY', 'Dólar Neozelandês / Iene',           'OPEN_MARKET', 85, TRUE, 'nz','jp', NULL,         19, NOW(), NOW()),
  ('asset_nzdusd',  'NZDUSD', 'Dólar Neozelandês / Dólar',          'OPEN_MARKET', 85, TRUE, 'nz','us', NULL,         20, NOW(), NOW()),

  -- ── OTC (24/7 synthetic) ────────────────────────────────────────────────
  ('asset_btcusd_otc', 'BTCUSD-OTC', 'Bitcoin OTC',                 'OTC',         90, TRUE, 'crypto:bitcoin', NULL,  NULL, 30, NOW(), NOW()),
  ('asset_usdbrl_otc', 'USDBRL-OTC', 'Dólar / Real (OTC)',          'OTC',         85, TRUE, 'us','br', NULL,         31, NOW(), NOW()),
  ('asset_eurnzd_otc', 'EURNZD-OTC', 'Euro / Dólar Neozelandês (OTC)','OTC',       85, TRUE, 'eu','nz', NULL,         32, NOW(), NOW()),
  ('asset_audnzd_otc', 'AUDNZD-OTC', 'Dólar Australiano / NZD (OTC)','OTC',        85, TRUE, 'au','nz', NULL,         33, NOW(), NOW()),
  ('asset_nzdcad_otc', 'NZDCAD-OTC', 'NZD / Canadense (OTC)',        'OTC',        85, TRUE, 'nz','ca', NULL,         34, NOW(), NOW()),
  ('asset_usddzd_otc', 'USDDZD-OTC', 'Dólar / Dinar Argelino (OTC)', 'OTC',        85, TRUE, 'us','dz', NULL,         35, NOW(), NOW()),
  ('asset_usdegp_otc', 'USDEGP-OTC', 'Dólar / Libra Egípcia (OTC)',  'OTC',        85, TRUE, 'us','eg', NULL,         36, NOW(), NOW()),
  ('asset_nzdchf_otc', 'NZDCHF-OTC', 'NZD / Franco Suíço (OTC)',     'OTC',        85, TRUE, 'nz','ch', NULL,         37, NOW(), NOW()),
  ('asset_audcad_otc', 'AUDCAD-OTC', 'Dólar AU / Canadense (OTC)',   'OTC',        85, TRUE, 'au','ca', NULL,         38, NOW(), NOW()),
  ('asset_audchf_otc', 'AUDCHF-OTC', 'Dólar AU / Franco Suíço (OTC)','OTC',        85, TRUE, 'au','ch', NULL,         39, NOW(), NOW()),
  ('asset_audjpy_otc', 'AUDJPY-OTC', 'Dólar AU / Iene (OTC)',        'OTC',        85, TRUE, 'au','jp', NULL,         40, NOW(), NOW()),
  ('asset_audusd_otc', 'AUDUSD-OTC', 'Dólar AU / Dólar (OTC)',       'OTC',        85, TRUE, 'au','us', NULL,         41, NOW(), NOW()),
  ('asset_cadchf_otc', 'CADCHF-OTC', 'Canadense / Franco Suíço (OTC)','OTC',       85, TRUE, 'ca','ch', NULL,         42, NOW(), NOW()),
  ('asset_cadjpy_otc', 'CADJPY-OTC', 'Canadense / Iene (OTC)',       'OTC',        85, TRUE, 'ca','jp', NULL,         43, NOW(), NOW()),
  ('asset_chfjpy_otc', 'CHFJPY-OTC', 'Franco Suíço / Iene (OTC)',    'OTC',        85, TRUE, 'ch','jp', NULL,         44, NOW(), NOW()),
  ('asset_euraud_otc', 'EURAUD-OTC', 'Euro / Dólar AU (OTC)',        'OTC',        85, TRUE, 'eu','au', NULL,         45, NOW(), NOW()),
  ('asset_eurcad_otc', 'EURCAD-OTC', 'Euro / Canadense (OTC)',       'OTC',        85, TRUE, 'eu','ca', NULL,         46, NOW(), NOW()),
  ('asset_eurchf_otc', 'EURCHF-OTC', 'Euro / Franco Suíço (OTC)',    'OTC',        85, TRUE, 'eu','ch', NULL,         47, NOW(), NOW()),
  ('asset_eurgbp_otc', 'EURGBP-OTC', 'Euro / Libra (OTC)',           'OTC',        85, TRUE, 'eu','gb', NULL,         48, NOW(), NOW()),
  ('asset_eurjpy_otc', 'EURJPY-OTC', 'Euro / Iene (OTC)',            'OTC',        85, TRUE, 'eu','jp', NULL,         49, NOW(), NOW()),
  ('asset_eurusd_otc', 'EURUSD-OTC', 'Euro / Dólar (OTC)',           'OTC',        85, TRUE, 'eu','us', NULL,         50, NOW(), NOW()),
  ('asset_gbpaud_otc', 'GBPAUD-OTC', 'Libra / Dólar AU (OTC)',       'OTC',        85, TRUE, 'gb','au', NULL,         51, NOW(), NOW()),
  ('asset_gbpcad_otc', 'GBPCAD-OTC', 'Libra / Canadense (OTC)',      'OTC',        85, TRUE, 'gb','ca', NULL,         52, NOW(), NOW()),
  ('asset_gbpchf_otc', 'GBPCHF-OTC', 'Libra / Franco Suíço (OTC)',   'OTC',        85, TRUE, 'gb','ch', NULL,         53, NOW(), NOW()),
  ('asset_gbpjpy_otc', 'GBPJPY-OTC', 'Libra / Iene (OTC)',           'OTC',        85, TRUE, 'gb','jp', NULL,         54, NOW(), NOW()),
  ('asset_gbpusd_otc', 'GBPUSD-OTC', 'Libra / Dólar (OTC)',          'OTC',        85, TRUE, 'gb','us', NULL,         55, NOW(), NOW()),
  ('asset_usdcad_otc', 'USDCAD-OTC', 'Dólar / Canadense (OTC)',      'OTC',        85, TRUE, 'us','ca', NULL,         56, NOW(), NOW()),
  ('asset_usdjpy_otc', 'USDJPY-OTC', 'Dólar / Iene (OTC)',           'OTC',        85, TRUE, 'us','jp', NULL,         57, NOW(), NOW()),

  -- ── Crypto (live Binance pricing) ───────────────────────────────────────
  ('asset_btcusdt', 'BTCUSDT', 'Bitcoin / Tether',                  'CRYPTO',      85, TRUE, 'crypto:bitcoin',  NULL, 'BTCUSDT', 80, NOW(), NOW()),
  ('asset_ethusdt', 'ETHUSDT', 'Ethereum / Tether',                 'CRYPTO',      85, TRUE, 'crypto:ethereum', NULL, 'ETHUSDT', 81, NOW(), NOW()),
  ('asset_solusdt', 'SOLUSDT', 'Solana / Tether',                   'CRYPTO',      85, TRUE, 'crypto:solana',   NULL, 'SOLUSDT', 82, NOW(), NOW())
ON CONFLICT (symbol) DO NOTHING;
