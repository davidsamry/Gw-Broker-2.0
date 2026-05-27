-- The logo is a transparent PNG, so it relies on the cell background
-- behind it to stay legible. The wrapper table already declares
-- `background:#161b27` but some clients (Outlook web in dark mode, iOS
-- Mail's auto-invert) override the parent's background-color while
-- leaving inline backgrounds on the leaf cell untouched. Set the bg
-- explicitly on the logo's <td> and on the body/wrapper so all 3 layers
-- of the email render consistently dark.
--
-- Idempotent — REPLACE() leaves rows untouched when the exact target
-- string isn't present.

-- 1) Logo cell: was `padding:32px 32px 16px 32px;text-align:center"`
--    Add an explicit dark background.
UPDATE "email_templates"
SET "htmlBody" = REPLACE(
  "htmlBody",
  'padding:32px 32px 16px 32px;text-align:center"><img src="{{logo_url}}"',
  'padding:32px 32px 16px 32px;text-align:center;background:#161b27"><img src="{{logo_url}}"'
),
"updatedAt" = NOW()
WHERE "htmlBody" LIKE '%padding:32px 32px 16px 32px;text-align:center"><img src="{{logo_url}}"%';

-- 2) Add `color-scheme:dark` + `supported-color-schemes:dark` to <head>
--    so Apple Mail / Outlook respect our dark palette and don't try to
--    flip light text on us.
UPDATE "email_templates"
SET "htmlBody" = REPLACE(
  "htmlBody",
  '<meta name="viewport" content="width=device-width,initial-scale=1"></head>',
  '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>'
),
"updatedAt" = NOW()
WHERE "htmlBody" LIKE '%<meta name="viewport" content="width=device-width,initial-scale=1"></head>%';
