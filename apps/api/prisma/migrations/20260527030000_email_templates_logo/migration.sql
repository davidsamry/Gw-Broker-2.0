-- Swap the plain-text "Vx Global" H1 header for the official PNG logo
-- in every email template. The logo URL is rendered at send time via the
-- BRAND_VARS injection in apps/api/src/email/service.ts, so admins can
-- swap the prod domain by changing the FRONTEND_URL env var without
-- editing any row here.
--
-- Idempotent — REPLACE() leaves the body untouched when the exact H1
-- isn't present (e.g. admin already customised the header). The
-- variables array is rebuilt with the two new keys merged in + dedup'd.

UPDATE "email_templates"
SET "htmlBody" = REPLACE(
  "htmlBody",
  '<h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1>',
  '<img src="{{logo_url}}" alt="{{brand_name}}" style="height:48px;display:block;margin:0 auto;max-width:240px;object-fit:contain">'
),
"variables" = ARRAY(
  SELECT DISTINCT v
  FROM unnest("variables" || ARRAY['logo_url', 'brand_name']) AS v
  ORDER BY v
),
"updatedAt" = NOW()
WHERE "htmlBody" LIKE '%<h1 style="color:#3b82f6;font-size:28px;margin:0">Vx Global</h1>%';
