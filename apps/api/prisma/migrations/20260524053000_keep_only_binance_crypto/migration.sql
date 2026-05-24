-- Drop everything except Binance-priced crypto. After this:
--   • Catalog reflects only assets with a real, verifiable price feed.
--   • OTC pricing worker boots with an empty cache (no rows match its
--     WHERE marketSymbol IS NULL filter) — endpoints /otc/* keep
--     responding 404/empty but cost nothing.
--   • Old operations table rows keep their assetId strings; there is no
--     FK from operations to assets, so they remain queryable. If one of
--     them somehow expires after this migration, the resolver's tick
--     lookup returns null → falls through to the random nudge (same
--     behaviour as before Etapa 6 for stale ops).
--
-- Cascade: asset_price_ticks has ON DELETE CASCADE on assetId, so the
-- tick history of the removed assets is dropped in the same statement.

DELETE FROM assets WHERE category <> 'CRYPTO';
