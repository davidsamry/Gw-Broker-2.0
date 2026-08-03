// User-tracking persistence. Captures fbp/fbc/utm/ip/userAgent at
// register time so the Meta Conversions API call later has rich
// attribution data. Stored in the user_tracking table (1-to-1 with User).

import { prisma } from '../prisma.js'

export interface TrackingFields {
  fbp?:         string | null
  fbc?:         string | null
  fbclid?:      string | null
  sck?:         string | null
  utmSource?:   string | null
  utmMedium?:   string | null
  utmCampaign?: string | null
  utmContent?:  string | null
  utmTerm?:     string | null
  ip?:          string | null
  userAgent?:   string | null
}

/**
 * UPSERT — first register writes the row, repeat calls (e.g. re-register
 * flow after delete) update in place. Idempotent + safe to call without
 * checking existence first.
 *
 * If `fbclid` is provided but `fbc` is missing, synthesise the canonical
 * Meta fbc format `fb.1.{epoch_ms}.{fbclid}`. This is exactly what the
 * Pixel JS does in the browser, so server-side events derived from a
 * landing page click look identical to ones from the Pixel.
 */
export async function saveUserTracking(userId: string, t: TrackingFields): Promise<void> {
  const fbc = t.fbc ?? (t.fbclid ? `fb.1.${Date.now()}.${t.fbclid}` : null)

  await prisma.$executeRaw`
    INSERT INTO user_tracking
      (id, "userId", fbp, fbc, fbclid, sck,
       "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm",
       ip, "userAgent", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::text, ${userId},
      ${t.fbp ?? null}, ${fbc}, ${t.fbclid ?? null}, ${t.sck ?? null},
      ${t.utmSource ?? null}, ${t.utmMedium ?? null}, ${t.utmCampaign ?? null},
      ${t.utmContent ?? null}, ${t.utmTerm ?? null},
      ${t.ip ?? null}, ${t.userAgent ?? null},
      NOW(), NOW()
    )
    ON CONFLICT ("userId") DO UPDATE SET
      fbp          = COALESCE(EXCLUDED.fbp,          user_tracking.fbp),
      fbc          = COALESCE(EXCLUDED.fbc,          user_tracking.fbc),
      fbclid       = COALESCE(EXCLUDED.fbclid,       user_tracking.fbclid),
      sck          = COALESCE(EXCLUDED.sck,          user_tracking.sck),
      "utmSource"  = COALESCE(EXCLUDED."utmSource",  user_tracking."utmSource"),
      "utmMedium"  = COALESCE(EXCLUDED."utmMedium",  user_tracking."utmMedium"),
      "utmCampaign"= COALESCE(EXCLUDED."utmCampaign",user_tracking."utmCampaign"),
      "utmContent" = COALESCE(EXCLUDED."utmContent", user_tracking."utmContent"),
      "utmTerm"    = COALESCE(EXCLUDED."utmTerm",    user_tracking."utmTerm"),
      ip           = COALESCE(EXCLUDED.ip,           user_tracking.ip),
      "userAgent"  = COALESCE(EXCLUDED."userAgent",  user_tracking."userAgent"),
      "updatedAt"  = NOW()
  `
}

export interface StoredTracking {
  fbp:         string | null
  fbc:         string | null
  sck:         string | null
  ip:          string | null
  userAgent:   string | null
}

/** Read back the tracking row for a user. Returns nulls if no row. */
export async function getUserTracking(userId: string): Promise<StoredTracking> {
  const rows = await prisma.$queryRaw<Array<StoredTracking>>`
    SELECT fbp, fbc, sck, ip, "userAgent"
    FROM user_tracking WHERE "userId" = ${userId} LIMIT 1
  `
  return rows[0] ?? { fbp: null, fbc: null, sck: null, ip: null, userAgent: null }
}
