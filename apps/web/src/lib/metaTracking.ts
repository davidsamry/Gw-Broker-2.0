// Client-side capture of Meta Pixel attribution data (fbp/fbc) and UTM
// parameters. Used by the register form to forward attribution to the
// backend, which persists it in user_tracking and dispatches the
// CompleteRegistration event via the Conversions API.
//
// Why this exists instead of using the Pixel JS directly:
// - The Pixel JS is a frontend-only fire — Meta de-dupes via event_id
//   between Pixel + Conversions API. We send via the API (server-side)
//   for higher delivery rate; we just need fbp/fbc/utm captured here.
//
// Lives in `lib/` (not inside any component) so server-rendered routes
// don't try to bundle it. All reads are guarded against `typeof window`.

export interface TrackingPayload {
  fbp?:         string | null
  fbc?:         string | null
  fbclid?:      string | null
  // click_id vindo no link do bot (?sck=...). Vira external_id no postback.
  sck?:         string | null
  utmSource?:   string | null
  utmMedium?:   string | null
  utmCampaign?: string | null
  utmContent?:  string | null
  utmTerm?:     string | null
}

const STORAGE_KEY = 'vx_meta_tracking_v1'

// ── Cookie helper ──────────────────────────────────────────────────────
// Pixel sets `_fbp` and `_fbc` as first-party cookies. We read them
// directly so even users blocking JS-init Pixel still send fbp/fbc to
// the API (the cookies persist across sessions).
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'))
  return m ? decodeURIComponent(m[2]) : null
}

// ── Capture (call once on landing pages + the auth/register page) ──
//
// Builds + caches the tracking payload from:
//   - _fbp / _fbc cookies (set by Pixel JS, if loaded)
//   - URL query string for fbclid + utm_*
// Result is merged into localStorage so the data survives navigation
// between the landing page and the register form.
//
// If fbclid is present and _fbc is missing, synthesises the canonical
// `fb.1.{epoch_ms}.{fbclid}` value — same shape the Pixel JS produces.
export function captureMetaTracking(): TrackingPayload {
  if (typeof window === 'undefined') return {}

  // Persisted snapshot from previous visits / landing page.
  let stored: TrackingPayload = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) stored = JSON.parse(raw)
  } catch { /* corrupt JSON, ignore */ }

  const url    = new URL(window.location.href)
  const fbclid = url.searchParams.get('fbclid')
  // fbp/fbc podem vir NO LINK do bot (?fbp=...&fbc=...) — prioridade sobre o
  // cookie, pois o bot preenche com o valor exato usado no clique.
  const fbp    = url.searchParams.get('fbp') || readCookie('_fbp') || stored.fbp || null
  let   fbc    = url.searchParams.get('fbc') || readCookie('_fbc') || stored.fbc || null
  // Synthesise fbc from fbclid if cookie absent. Format MUST match what
  // Pixel JS writes — Meta's de-dupe / attribution treats them the same.
  if (!fbc && fbclid) {
    fbc = `fb.1.${Date.now()}.${fbclid}`
  }

  const payload: TrackingPayload = {
    fbp,
    fbc,
    fbclid:      fbclid || stored.fbclid || null,
    // click_id do bot — external_id do postback. Sobrevive à navegação.
    sck:         url.searchParams.get('sck') || stored.sck || null,
    utmSource:   url.searchParams.get('utm_source')   || stored.utmSource   || null,
    utmMedium:   url.searchParams.get('utm_medium')   || stored.utmMedium   || null,
    utmCampaign: url.searchParams.get('utm_campaign') || stored.utmCampaign || null,
    utmContent:  url.searchParams.get('utm_content')  || stored.utmContent  || null,
    utmTerm:     url.searchParams.get('utm_term')     || stored.utmTerm     || null,
  }

  // Persist for future page loads. Only the non-null subset to keep
  // the row small + readable in DevTools.
  try {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(payload)) if (v) out[k] = String(v)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
  } catch { /* quota / private mode — ignore */ }

  return payload
}

/** Re-reads the cached payload without recapturing from the URL. */
export function loadMetaTracking(): TrackingPayload {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as TrackingPayload
  } catch {
    return {}
  }
}
