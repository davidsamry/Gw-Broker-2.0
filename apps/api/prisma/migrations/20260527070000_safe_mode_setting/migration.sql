-- Adds the Modo Seguro (Anti-DevTools) toggle to PlatformSettings.
-- When true, the frontend's SafeMode component activates a set of
-- client-side deterrents against casual DevTools snooping. Defaults
-- to FALSE so existing installs stay unchanged after the migration.
--
-- IMPORTANT: this is a UX deterrent, not security. A motivated user
-- can bypass it (disable JS, use curl/Postman, hit the API directly).
-- The real security boundary remains the backend authn + authz.
ALTER TABLE "platform_settings"
  ADD COLUMN "safeModeEnabled" BOOLEAN NOT NULL DEFAULT FALSE;
