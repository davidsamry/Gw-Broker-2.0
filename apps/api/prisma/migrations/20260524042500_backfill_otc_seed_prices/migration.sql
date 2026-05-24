-- Backfill the OTC seedPrice column from the prices the trading frontend
-- has been displaying (apps/web/src/lib/mockData.ts). Once the OTC worker
-- starts (Etapa 2), it'll bootstrap from these baselines and random-walk
-- around them. Open-market and Binance crypto assets are intentionally
-- skipped — they get pricing from Binance, not the OTC engine.

-- ── OTC moedas ─────────────────────────────────────────────────────────────
UPDATE assets SET "seedPrice" = 5.74200    WHERE id = 'usd-brl-otc';
UPDATE assets SET "seedPrice" = 1.78120    WHERE id = 'eur-nzd-otc';
UPDATE assets SET "seedPrice" = 1.08910    WHERE id = 'aud-nzd-otc';
UPDATE assets SET "seedPrice" = 0.82340    WHERE id = 'nzd-cad-otc';
UPDATE assets SET "seedPrice" = 134.52000  WHERE id = 'usd-dzd-otc';
UPDATE assets SET "seedPrice" = 30.90000   WHERE id = 'usd-egp-otc';
UPDATE assets SET "seedPrice" = 0.54210    WHERE id = 'nzd-chf-otc';
UPDATE assets SET "seedPrice" = 17.12000   WHERE id = 'usd-mxn-otc';
UPDATE assets SET "seedPrice" = 3921.50000 WHERE id = 'usd-cop-otc';
UPDATE assets SET "seedPrice" = 1480.00000 WHERE id = 'usd-ngn-otc';
UPDATE assets SET "seedPrice" = 83.12000   WHERE id = 'usd-inr-otc';
UPDATE assets SET "seedPrice" = 889.50000  WHERE id = 'usd-ars-otc';
UPDATE assets SET "seedPrice" = 0.67120    WHERE id = 'cad-chf-otc';
UPDATE assets SET "seedPrice" = 2.03410    WHERE id = 'gbp-nzd-otc';
UPDATE assets SET "seedPrice" = 1.64230    WHERE id = 'eur-aud-otc';
UPDATE assets SET "seedPrice" = 1.14320    WHERE id = 'gbp-chf-otc';
UPDATE assets SET "seedPrice" = 0.89710    WHERE id = 'usd-chf-otc';
UPDATE assets SET "seedPrice" = 0.97320    WHERE id = 'eur-chf-otc';
UPDATE assets SET "seedPrice" = 1.34210    WHERE id = 'usd-sgd-otc';
UPDATE assets SET "seedPrice" = 3.98210    WHERE id = 'usd-pln-otc';

-- ── OTC cripto ─────────────────────────────────────────────────────────────
UPDATE assets SET "seedPrice" = 484.20000   WHERE id = 'bch-otc';
UPDATE assets SET "seedPrice" = 612.30000   WHERE id = 'bnb-otc';
UPDATE assets SET "seedPrice" = 27.84000    WHERE id = 'etc-otc';
UPDATE assets SET "seedPrice" = 84.52000    WHERE id = 'ltc-otc';
UPDATE assets SET "seedPrice" = 172.40000   WHERE id = 'sol-otc';
UPDATE assets SET "seedPrice" = 11.24000    WHERE id = 'trump-otc';
UPDATE assets SET "seedPrice" = 0.51230     WHERE id = 'xrp-otc';
UPDATE assets SET "seedPrice" = 28.91000    WHERE id = 'zec-otc';
UPDATE assets SET "seedPrice" = 8.21000     WHERE id = 'atom-otc';
UPDATE assets SET "seedPrice" = 29.14000    WHERE id = 'dash-otc';
UPDATE assets SET "seedPrice" = 7.42000     WHERE id = 'dot-otc';
UPDATE assets SET "seedPrice" = 14.32000    WHERE id = 'link-otc';
UPDATE assets SET "seedPrice" = 5.87000     WHERE id = 'axs-otc';
UPDATE assets SET "seedPrice" = 67420.00000 WHERE id = 'btc-otc';
UPDATE assets SET "seedPrice" = 3521.00000  WHERE id = 'eth-otc';
UPDATE assets SET "seedPrice" = 0.45210     WHERE id = 'ada-otc';
UPDATE assets SET "seedPrice" = 0.16210     WHERE id = 'doge-otc';

-- ── OTC commodities + stocks ───────────────────────────────────────────────
UPDATE assets SET "seedPrice" = 84.21000   WHERE id = 'ukbrent-otc';
UPDATE assets SET "seedPrice" = 79.54000   WHERE id = 'uscrude-otc';
UPDATE assets SET "seedPrice" = 147.82000  WHERE id = 'jnj-otc';
UPDATE assets SET "seedPrice" = 30.21000   WHERE id = 'intc-otc';
UPDATE assets SET "seedPrice" = 421.54000  WHERE id = 'msft-otc';
UPDATE assets SET "seedPrice" = 182.41000  WHERE id = 'ba-otc';
UPDATE assets SET "seedPrice" = 512.30000  WHERE id = 'meta-otc';
UPDATE assets SET "seedPrice" = 28.14000   WHERE id = 'pfe-otc';
UPDATE assets SET "seedPrice" = 278.92000  WHERE id = 'mcd-otc';
UPDATE assets SET "seedPrice" = 231.45000  WHERE id = 'axp-otc';
UPDATE assets SET "seedPrice" = 189.21000  WHERE id = 'aapl-otc';
UPDATE assets SET "seedPrice" = 178.42000  WHERE id = 'googl-otc';
UPDATE assets SET "seedPrice" = 192.15000  WHERE id = 'amzn-otc';
UPDATE assets SET "seedPrice" = 172.80000  WHERE id = 'tsla-otc';
