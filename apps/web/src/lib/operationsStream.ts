// SSE client for /operations/stream.
//
// Opens a persistent EventSource per logged-in tab. When the server
// emits an operation event ('created' or 'resolved') we upsert it into
// the operations store — TradingPanel's open + closed trade lists
// re-render automatically, so:
//
// • A bot firing a trade via /bot/v1/trade pops the op into the user's
//   open browser tab without a page refresh.
// • A second device logged into the same account sees the trade open
//   on device A appear on device B's panel within ~50ms.
// • Resolution (worker.resolveOperation) syncs across every connected
//   session — closed trades + new balance show up live.
//
// EventSource can't set custom headers, so the token rides in a query
// param. Browser auto-reconnects on network drop.

'use client'

import { useEffect, useRef } from 'react'
import { useOperationsStore, type ApiOperation } from '@/store/operations'
import { useAuthStore } from '@/store/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** Open an EventSource against /operations/stream. Returns a function
 *  that closes the stream + tears down all listeners. */
export function openOperationsStream(
  token:   string,
  onEvent: (event: { kind: 'created' | 'resolved'; op: ApiOperation }) => void,
): () => void {
  const url = `${API_URL.replace(/\/$/, '')}/operations/stream?token=${encodeURIComponent(token)}`
  const es  = new EventSource(url)

  const handleCreated = (ev: MessageEvent) => {
    try { onEvent({ kind: 'created', op: JSON.parse(ev.data) as ApiOperation }) }
    catch { /* malformed payload — ignore */ }
  }
  const handleResolved = (ev: MessageEvent) => {
    try { onEvent({ kind: 'resolved', op: JSON.parse(ev.data) as ApiOperation }) }
    catch { /* malformed payload — ignore */ }
  }

  es.addEventListener('created',  handleCreated)
  es.addEventListener('resolved', handleResolved)

  // No explicit reconnect logic — EventSource auto-reconnects with a
  // backoff that respects the server's `retry:` field (default 3s).

  return () => {
    es.removeEventListener('created',  handleCreated)
    es.removeEventListener('resolved', handleResolved)
    es.close()
  }
}

/** React hook: opens the stream when the user is logged in and tears
 *  it down on logout / unmount. Each event upserts the op into the
 *  shared operations store + schedules a debounced refreshAccounts so
 *  the balance reconciles against the server (avoids double-credit
 *  races with the local placeTrade's optimistic delta). */
export function useOperationsStream() {
  const token            = useAuthStore((s) => s.token)
  const user             = useAuthStore((s) => s.user)
  const upsertOne        = useOperationsStore((s) => s.upsertOne)
  const refreshAccounts  = useAuthStore((s) => s.refreshAccounts)

  const closeRef    = useRef<(() => void) | null>(null)
  // Debounce timer for refreshAccounts — a flurry of events (e.g. several
  // ops resolving in the same worker tick) collapses to one /accounts RTT.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Tear down any prior stream first (logout, token change).
    closeRef.current?.()
    closeRef.current = null

    if (!token || !user) return

    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null
        // refreshAccounts hits /accounts — small payload, ~50ms RTT.
        // Server is source of truth for balance, so this reconciles any
        // drift from optimistic local deltas.
        refreshAccounts().catch(() => { /* network blip — next event will retry */ })
      }, 150)
    }

    const close = openOperationsStream(token, ({ kind, op }) => {
      upsertOne(op)
      // Only RESOLVED events change the balance (WON credits stake +
      // profit; LOST is a no-op since the stake was already debited on
      // creation). CREATED events do change the balance too (debit) but
      // for those, the originator is either:
      //   (a) the same tab — placeTrade already did the optimistic debit
      //   (b) another device — handled by `kind === 'created'` here
      //   (c) a bot via /bot/v1/trade — handled here too
      // Refreshing on every event is the simplest correct behavior.
      scheduleRefresh()
    })

    closeRef.current = close
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current)
        refreshTimer.current = null
      }
      close()
      closeRef.current = null
    }
  }, [token, user?.id, upsertOne, refreshAccounts])
}
