'use client'

// SafeMode — UX-level Anti-DevTools deterrent.
//
// IMPORTANT CAVEAT: this is NOT security. A motivated user can bypass
// it by disabling JS, using curl/Postman, viewing source from a CDN
// cache, opening DevTools BEFORE navigating to the site, etc. The
// real security boundary is the API: backend must never trust the
// frontend and must enforce authn + authz on every request.
//
// What this component does (when settings.safeModeEnabled is on):
//   1. Blocks the right-click context menu globally.
//   2. Intercepts keyboard shortcuts that open DevTools or View Source:
//      F12, Ctrl/Cmd+Shift+I, Ctrl/Cmd+Shift+J, Ctrl/Cmd+Shift+C, Ctrl/Cmd+U
//   3. Polls window.outer/inner size to detect a docked DevTools panel
//      (a known imperfect heuristic — undocked DevTools won't trigger it).
//   4. Clears the console every 2 seconds so anything logged before
//      detection scrolls out quickly.
//   5. On detection: tries window.close(). Browsers refuse to close
//      tabs not opened by JS — fallback is to replace the page with a
//      blank shielded screen.
//
// Activation rules:
//   - Always exempt: any pathname starting with /admin (so the admin
//     panel can be debugged regardless of the global toggle).
//   - Mounted in the root layout so it runs on every page (login,
//     register, password reset, and the authenticated app).
//   - Fetches /public-settings once on mount to know the flag; caches
//     the result in localStorage for instant activation on subsequent
//     loads (the network roundtrip would otherwise leave a ~50-300ms
//     window where DevTools is unblocked).

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const STORAGE_KEY = 'vx_safe_mode_v1'
const STORAGE_TTL = 24 * 60 * 60 * 1000   // 24h
const POLL_INTERVAL_MS = 1000
// Width/height delta between outer and inner that we treat as "devtools
// is docked". Empirically 160px catches Chrome's default docked panel
// without false-positives from browser chrome (toolbar, scrollbars).
const DEVTOOLS_THRESHOLD_PX = 160

interface CachedFlag { v: boolean; t: number }

function readCachedFlag(): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedFlag
    if (Date.now() - parsed.t > STORAGE_TTL) return null
    return parsed.v
  } catch { return null }
}

function writeCachedFlag(v: boolean) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v, t: Date.now() }))
  } catch { /* quota / private mode */ }
}

// Best-effort tab close + fallback to blank screen. Browsers block
// window.close() on tabs the user opened directly (not via JS), so we
// can't rely on it alone.
function shutDown() {
  try {
    window.close()
  } catch { /* ignore */ }
  // Fallback — replace the body so the now-open DevTools shows nothing
  // useful, and the user understands what happened.
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = `
      <div style="
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        background: #0b0d12; color: #e8eaf0;
        font-family: -apple-system, system-ui, sans-serif;
        gap: 8px; text-align: center; padding: 24px;
      ">
        <div style="font-size: 32px;">🔒</div>
        <div style="font-size: 16px; font-weight: 700;">Acesso bloqueado</div>
        <div style="font-size: 13px; color: #8b8f9a; max-width: 360px;">
          O DevTools foi detectado. Feche as ferramentas de desenvolvedor e recarregue a página.
        </div>
      </div>
    `
  }
}

export function SafeMode() {
  const pathname = usePathname()

  // Admin pages are always exempt — even if the flag is on, we never
  // arm the listeners on /admin/* so an admin can't lock themselves out.
  const isAdminRoute = pathname?.startsWith('/admin') ?? false

  // Fetch the public flag (with localStorage warm cache for instant arming).
  // Effect re-runs when the route changes so navigating from /admin to
  // / picks up activation without a full reload.
  useEffect(() => {
    if (isAdminRoute) return

    // Read cached value synchronously — if true, we'll arm immediately
    // even before the network fetch returns. If false/null, wait for
    // the fetch to decide.
    const cached = readCachedFlag()
    let armed   = false
    let cleanup: (() => void) | null = null

    function arm() {
      if (armed) return
      armed = true

      const onContextMenu = (e: MouseEvent) => { e.preventDefault() }
      const onKeyDown = (e: KeyboardEvent) => {
        // F12 — open DevTools
        if (e.key === 'F12') { e.preventDefault(); shutDown(); return }
        // Ctrl/Cmd + Shift + I/J/C — DevTools shortcuts on Chromium/Firefox
        const mod = e.ctrlKey || e.metaKey
        if (mod && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) {
          e.preventDefault(); shutDown(); return
        }
        // Ctrl/Cmd + U — View Source
        if (mod && e.key.toUpperCase() === 'U') {
          e.preventDefault(); shutDown(); return
        }
      }

      // Periodic devtools-open detection via window size delta. Docked
      // DevTools shrinks the inner viewport while leaving outer alone;
      // a >160px gap on either axis is the signal.
      const checkDevtools = () => {
        const wGap = Math.abs(window.outerWidth  - window.innerWidth)
        const hGap = Math.abs(window.outerHeight - window.innerHeight)
        if (wGap > DEVTOOLS_THRESHOLD_PX || hGap > DEVTOOLS_THRESHOLD_PX) {
          shutDown()
        }
      }
      const pollId = window.setInterval(checkDevtools, POLL_INTERVAL_MS)

      // Periodic console clear — gives the page time to "wipe its
      // tracks" if devtools is briefly opened then closed.
      const clearId = window.setInterval(() => {
        try { console.clear() } catch { /* ignore */ }
      }, 2000)

      window.addEventListener('contextmenu', onContextMenu)
      window.addEventListener('keydown',     onKeyDown)

      cleanup = () => {
        window.removeEventListener('contextmenu', onContextMenu)
        window.removeEventListener('keydown',     onKeyDown)
        window.clearInterval(pollId)
        window.clearInterval(clearId)
      }
    }

    if (cached === true) arm()

    // Always re-fetch to refresh the cache (admin may have toggled).
    // Uses the same base URL the rest of the app uses (NEXT_PUBLIC_API_URL).
    let cancelled = false
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    fetch(`${apiBase}/public/settings`)
      .then((res) => res.ok ? res.json() : null)
      .then((data: { safeModeEnabled?: boolean } | null) => {
        if (cancelled) return
        const enabled = data?.safeModeEnabled === true
        writeCachedFlag(enabled)
        if (enabled && !armed) arm()
        // If the cached value was true but the live value is false, we
        // intentionally do NOT disarm — the listeners only attach once
        // per mount; a navigation will re-evaluate.
      })
      .catch(() => { /* silent — fall back to cached arming */ })

    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
  }, [isAdminRoute, pathname])

  return null
}
