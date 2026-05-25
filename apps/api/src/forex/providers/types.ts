// Provider abstraction — every market data source plugged into the forex
// module conforms to this contract. Implementing a new provider is just a
// matter of writing a class that satisfies `MarketProvider`; nothing else
// in the module needs to know which provider is active.

import type { ForexAssetConfig, ForexTick } from '../types.js'

export type ProviderStatus =
  | 'INITIAL'        // never connected
  | 'CONNECTING'     // socket + handshake in progress
  | 'AUTHED'         // ready to subscribe
  | 'RECONNECTING'   // lost connection, retrying
  | 'STOPPED'        // explicitly shut down — won't auto-recover

export interface ProviderEvents {
  /** Called once per tick received from the provider. Already normalised:
   *  symbolId resolved to our `assetId`, bid/ask in asset's price scale. */
  onTick:     (tick: ForexTick) => void
  /** Connection state changes — useful for admin status + metrics. */
  onStatus:   (status: ProviderStatus, detail?: string) => void
  /** Fatal error (e.g., bad credentials) — the runtime decides whether to
   *  surface to admin / page on-call. NOT used for transient network blips
   *  (those just trigger reconnect + an onStatus call). */
  onError:    (err: Error) => void
}

export interface MarketProvider {
  /** Stable provider name for logs/metrics. */
  readonly name: string

  /** Connect, authenticate, and resolve symbol mappings. The runtime calls
   *  this once at boot. Throws on unrecoverable errors (bad credentials,
   *  missing config); transient failures are handled internally with
   *  reconnect. Returns once the provider is in AUTHED state. */
  start(assets: ForexAssetConfig[], events: ProviderEvents): Promise<void>

  /** Subscribe to spot prices for the given asset. Idempotent — duplicate
   *  calls for the same asset are no-ops. */
  subscribe(assetId: string): Promise<void>

  /** Stop receiving updates for an asset. Idempotent. */
  unsubscribe(assetId: string): Promise<void>

  /** Graceful shutdown. Closes the underlying connection, sets status to
   *  STOPPED, drains any in-flight resources. */
  stop(): Promise<void>

  /** Current status — read for /admin/forex/status and metrics. */
  getStatus(): ProviderStatus

  /** Provider-specific debug snapshot (last reconnect time, message
   *  counts, latency p50/p95). Shape is opaque; the admin panel just
   *  renders it as JSON. */
  getDebugInfo(): Record<string, unknown>
}
