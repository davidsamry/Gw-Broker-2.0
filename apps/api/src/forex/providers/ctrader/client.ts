// cTrader Open API client — uses @reiryoku/ctrader-layer for the wire
// protocol (TCP+TLS+Protobuf, length-prefix framing, message correlation).
//
// Why a library: cTrader does NOT reliably support JSON-over-WebSocket
// across broker proxies (the F1 hand-rolled JSON client got "Bye" closes
// before the first handshake message could be sent). The Protobuf layer
// is well-specified and stable; reusing a battle-tested wrapper saves us
// vendoring the .proto files and implementing length-prefix framing.
//
// What we keep doing ourselves:
//   • Lifecycle wrapping (start/stop/subscribe matching MarketProvider)
//   • Symbol mapping (SymbolsList → forex_assets.ctraderSymbolId)
//   • Tick normalisation (scaled int → decimal, midpoint, ForexTick shape)
//   • Reconnect with backoff (the library doesn't auto-reconnect)
//   • Heartbeat (library has sendHeartbeat() but we drive the cadence)
//
// Vulnerability note (post-MVP): the library depends on protobufjs@5 and
// axios@0.21 — both have known CVEs. Acceptable for demo, must revisit
// before going live.

import { CTraderConnection } from '@reiryoku/ctrader-layer'
import type {
  MarketProvider, ProviderEvents, ProviderStatus,
} from '../types.js'
import type { ForexAssetConfig } from '../../types.js'
import { prisma } from '../../../prisma.js'

const HEARTBEAT_INTERVAL_MS = 25_000  // library README's suggested cadence
const RECONNECT_BACKOFFS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
// Polling cadence for the trendbars fallback. cTrader's ProtoOASpotEvent
// arrives but the bundled protobufjs@5 decodes the payload as `{}`, so
// we drive price updates by polling the latest M1 candle close instead.
// 1500ms across 5 pairs = 3.3 req/sec, well under cTrader rate limit.
const POLL_INTERVAL_MS = 1_500

export interface CTraderConfig {
  host:                string
  clientId:            string
  clientSecret:        string
  accessToken:         string
  refreshToken:        string
  ctidTraderAccountId: number
}

interface SymbolListEntry {
  symbolId:   number
  symbolName: string
  enabled:    boolean
}

// Shape of ProtoOAGetTrendbarsRes that we care about. cTrader serialises
// every numeric field as a STRING through protobufjs JSON — coerce on
// read. Fields beyond these (volume, period, etc.) are present but
// unused by the polling code.
interface TrendbarPayload {
  low?:         number | string
  deltaOpen?:   number | string
  deltaClose?:  number | string
  deltaHigh?:   number | string
  utcTimestampInMinutes?: number | string
}
interface TrendbarsRes {
  trendbar?: TrendbarPayload[]
}

export class CTraderClient implements MarketProvider {
  readonly name = 'ctrader'
  private status: ProviderStatus = 'INITIAL'

  private connection: CTraderConnection | null = null
  private events:     ProviderEvents | null    = null
  private assets:     ForexAssetConfig[]       = []
  /** assetId → ctraderSymbolId (resolved at SymbolsList) */
  private symbolMap = new Map<string, number>()

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout>  | null = null
  private pollTimer:      ReturnType<typeof setInterval> | null = null
  private reconnectStep   = 0
  private intentionalClose = false

  // Stats for getDebugInfo
  private connectedAt:      number | null = null
  private lastTickAt:       number | null = null
  private ticksReceived     = 0
  private reconnectCount    = 0
  private lastErrorMessage: string | null = null

  constructor(private config: CTraderConfig) {}

  async start(assets: ForexAssetConfig[], events: ProviderEvents): Promise<void> {
    this.assets = assets
    this.events = events
    this.intentionalClose = false
    await this.connect()
  }

  async stop(): Promise<void> {
    this.intentionalClose = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.pollTimer)      { clearInterval(this.pollTimer);      this.pollTimer = null      }
    try { (this.connection as any)?.close?.() } catch { /* lib may not expose close */ }
    this.connection = null
    this.setStatus('STOPPED')
  }

  async subscribe(assetId: string): Promise<void> {
    const symbolId = this.symbolMap.get(assetId)
    if (!symbolId || !this.connection) return
    try {
      await this.connection.sendCommand('ProtoOASubscribeSpotsReq', {
        ctidTraderAccountId: this.config.ctidTraderAccountId,
        symbolId: [symbolId],
      })
    } catch (err) {
      this.log(`subscribe ${assetId} failed: ${(err as Error).message}`)
    }
  }

  async unsubscribe(_assetId: string): Promise<void> {
    // F2: not used. Subscriptions persist for connection lifetime.
  }

  getStatus(): ProviderStatus { return this.status }

  getDebugInfo(): Record<string, unknown> {
    return {
      provider:       'ctrader',
      host:           this.config.host,
      ctidTraderAcct: this.config.ctidTraderAccountId,
      status:         this.status,
      connectedAt:    this.connectedAt,
      lastTickAt:     this.lastTickAt,
      ticksReceived:  this.ticksReceived,
      reconnectCount: this.reconnectCount,
      symbolMap:      Object.fromEntries(this.symbolMap),
      lastError:      this.lastErrorMessage,
    }
  }

  // ── Connection lifecycle ──────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.intentionalClose) return
    this.setStatus(this.reconnectStep > 0 ? 'RECONNECTING' : 'CONNECTING')
    this.log(`connecting to ${this.config.host}:5035 (TCP+TLS+Protobuf via @reiryoku/ctrader-layer)`)

    try {
      this.connection = new CTraderConnection({
        host: this.config.host,
        port: 5035,
      })

      // We intentionally do NOT subscribe to ProtoOASpotEvent — the
      // bundled protobufjs@5 decodes the payload as `{}` (incompatible
      // with cTrader's current wire format). Instead we poll the latest
      // M1 trendbar close every POLL_INTERVAL_MS — see startPolling().
      // The same Trendbars endpoint works correctly through the library.
      //
      // Notable session-level events are still useful for debugging.
      this.connection.on('ProtoOAClientDisconnectEvent', (e: any) => {
        this.log(`server disconnect: ${JSON.stringify(e).slice(0, 200)}`)
      })
      this.connection.on('ProtoOAAccountsTokenInvalidatedEvent', (e: any) => {
        this.log(`token invalidated: ${JSON.stringify(e).slice(0, 200)}`)
      })
      this.connection.on('ProtoOAErrorRes', (e: any) => {
        this.log(`server error: ${JSON.stringify(e).slice(0, 300)}`)
      })

      // The library doesn't auto-reconnect or surface 'close' events
      // consistently across versions, so we poll the underlying state
      // via a heartbeat — if heartbeat throws, we reconnect.

      await this.connection.open()
      this.connectedAt = Date.now()
      this.log('socket open — beginning handshake')

      // 1. Application auth — proves we own the OAuth app.
      await this.connection.sendCommand('ProtoOAApplicationAuthReq', {
        clientId:     this.config.clientId,
        clientSecret: this.config.clientSecret,
      })
      this.log('application authenticated')

      // 2. Account auth — proves we have access to the user's account.
      await this.connection.sendCommand('ProtoOAAccountAuthReq', {
        ctidTraderAccountId: this.config.ctidTraderAccountId,
        accessToken:         this.config.accessToken,
      })
      this.log(`account ${this.config.ctidTraderAccountId} authenticated`)
      this.setStatus('AUTHED')

      // 3. SymbolsList → map our 5 pairs to cTrader's internal IDs.
      const list = await this.connection.sendCommand('ProtoOASymbolsListReq', {
        ctidTraderAccountId: this.config.ctidTraderAccountId,
      }) as { symbol?: SymbolListEntry[] }
      await this.mapSymbols(list.symbol ?? [])

      // 4. Subscribe to spots for every mapped asset.
      const ids: number[] = []
      for (const a of this.assets) {
        const id = this.symbolMap.get(a.id)
        if (id) ids.push(id)
      }
      if (ids.length === 0) {
        this.log('WARNING: no symbols matched — nothing to poll')
      } else {
        this.log(`polling ${ids.length} symbols every ${POLL_INTERVAL_MS}ms`)
        this.startPolling()
      }

      // Heartbeat loop — also doubles as a connection-alive check.
      // If sendHeartbeat throws, we treat it as a disconnect and reconnect.
      this.startHeartbeat()

      // Reset reconnect backoff on a clean connection.
      this.reconnectStep = 0
    } catch (err) {
      this.recordError(`connect/handshake failed: ${(err as Error).message}`)
      try { (this.connection as any)?.close?.() } catch { /* ignore */ }
      this.connection = null
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return
    if (this.pollTimer)      { clearInterval(this.pollTimer);      this.pollTimer = null      }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    this.reconnectCount++
    const delay = RECONNECT_BACKOFFS_MS[Math.min(this.reconnectStep, RECONNECT_BACKOFFS_MS.length - 1)]
    this.reconnectStep++
    this.setStatus('RECONNECTING', `next attempt in ${delay}ms`)
    this.log(`reconnect scheduled in ${delay}ms`)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  // ── Trendbars polling (substitute for broken SpotEvent decode) ────────
  //
  // Every POLL_INTERVAL_MS we fan out one ProtoOAGetTrendbarsReq per
  // mapped symbol, asking for the latest 1 M1 candle. The close of that
  // candle becomes our "current price" for the asset.
  //
  // Caveat: prices update at most every 1.5s, not every tick. Good enough
  // for binary options of 60s+; F3 will use these to build candles for the
  // chart. If we later want sub-second, swap in the SpotEvent decoder fix.
  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    // Run immediately so we get prices in the first second, not after a
    // full POLL_INTERVAL_MS gap.
    void this.pollAll()
    this.pollTimer = setInterval(() => { void this.pollAll() }, POLL_INTERVAL_MS)
  }

  private async pollAll(): Promise<void> {
    if (!this.connection) return
    // Fan-out: 5 parallel requests. cTrader handles concurrent commands
    // fine (the library multiplexes on the same TCP connection via
    // clientMsgId).
    const tasks = this.assets.map((a) => this.pollOne(a))
    await Promise.allSettled(tasks)
  }

  private async pollOne(asset: ForexAssetConfig): Promise<void> {
    const symbolId = this.symbolMap.get(asset.id)
    if (!symbolId || !this.connection) return

    try {
      const now = Date.now()
      // Ask for the most recent M1 candle. fromTimestamp 2 minutes back
      // guarantees we get the in-progress bar plus the prior closed one.
      const res = await this.connection.sendCommand('ProtoOAGetTrendbarsReq', {
        ctidTraderAccountId: this.config.ctidTraderAccountId,
        symbolId,
        period:              'M1',
        fromTimestamp:       now - 2 * 60 * 1000,
        toTimestamp:         now,
        count:               2,
      }) as TrendbarsRes

      const bars = res.trendbar
      if (!bars || bars.length === 0) return

      // Latest bar (last in the array). cTrader trendbars are int-encoded
      // deltas off `low`: open = low + deltaOpen, close = low + deltaClose.
      const last = bars[bars.length - 1]
      const low  = Number(last.low)
      if (!Number.isFinite(low)) return
      const closeRaw = low + Number(last.deltaClose ?? 0)
      // cTrader serialises every price as 1/100_000 of a unit, independent
      // of the asset's display digits. e.g. 1.23 → 123_000. USD/JPY at
      // ~159.46 arrives as 15_946_000. Don't use `asset.digits` here —
      // that's for DISPLAY precision, not the wire format scale.
      const close    = closeRaw / 100_000

      this.lastTickAt = now
      this.ticksReceived++

      // We don't have separate bid/ask from trendbars — use close as both.
      // If F3 later wants spread modelling, it can synthesise from pipSize.
      console.log(
        `[forex/ctrader] tick ${asset.id}` +
        ` close=${close.toFixed(asset.digits)}` +
        ` (M1 close, polled)`,
      )

      this.events?.onTick({
        assetId:   asset.id,
        bid:       close,
        ask:       close,
        mid:       close,
        timestamp: now,
      })
    } catch (err) {
      // One-pair failure is non-fatal; the next poll will retry. Only log
      // when the failure rate seems abnormal.
      // (Could add per-asset error counters here if we ever need them.)
      void err
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      try {
        this.connection?.sendHeartbeat()
      } catch (err) {
        this.log(`heartbeat failed → reconnecting (${(err as Error).message})`)
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
        this.scheduleReconnect()
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  // ── Symbol mapping ────────────────────────────────────────────────────

  private async mapSymbols(symbols: SymbolListEntry[]): Promise<void> {
    // Normalise both sides so "EUR/USD" or "EURUSD.r" still matches "EURUSD".
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '')
    const byNormalized = new Map<string, number>()
    for (const s of symbols) {
      if (!s.enabled) continue
      byNormalized.set(norm(s.symbolName), s.symbolId)
    }

    this.symbolMap.clear()
    const updates: Array<{ id: string; symbolId: number }> = []
    for (const asset of this.assets) {
      const raw = byNormalized.get(norm(asset.symbol))
      // cTrader serialises symbolId as a string. Coerce to Number once
      // here so the reverse-lookup in handleSpotEvent (`map.get() === sym
      // Id`) compares apples to apples instead of "1" !== 1.
      const id = raw != null ? Number(raw) : null
      if (id != null && Number.isFinite(id)) {
        this.symbolMap.set(asset.id, id)
        updates.push({ id: asset.id, symbolId: id })
      } else {
        this.log(`WARNING: symbol "${asset.symbol}" not found in cTrader catalog`)
      }
    }

    // Persist the mapping so the admin panel + future restarts see it.
    // Cast to int because cTrader's symbolId arrives as a Long/string in
    // some library versions but the column is INTEGER.
    for (const u of updates) {
      try {
        await prisma.$executeRaw`
          UPDATE forex_assets SET "ctraderSymbolId" = ${Number(u.symbolId)}::int WHERE id = ${u.id}
        `
      } catch (err) {
        this.log(`failed to persist symbolId for ${u.id}: ${err}`)
      }
    }
    this.log(`symbol map built: ${updates.length}/${this.assets.length} pairs mapped`)
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private setStatus(s: ProviderStatus, detail?: string): void {
    this.status = s
    this.events?.onStatus(s, detail)
  }

  private recordError(message: string): void {
    this.lastErrorMessage = message
    this.events?.onError(new Error(message))
  }

  private log(message: string): void {
    console.log(`[forex/ctrader] ${message}`)
  }
}

/** Build a cTrader client from env. Returns null when any required env
 *  is missing — runtime falls back to no-op mode. */
export function tryCreateCTraderClient(): CTraderClient | null {
  const host         = process.env.CTRADER_HOST
  const clientId     = process.env.CTRADER_CLIENT_ID
  const clientSecret = process.env.CTRADER_CLIENT_SECRET
  const accessToken  = process.env.CTRADER_ACCESS_TOKEN
  const refreshToken = process.env.CTRADER_REFRESH_TOKEN
  const ctidRaw      = process.env.CTRADER_CTID_TRADER_ACCOUNT_ID

  if (!host || !clientId || !clientSecret || !accessToken || !refreshToken || !ctidRaw) {
    return null
  }
  const ctidTraderAccountId = Number(ctidRaw)
  if (!Number.isFinite(ctidTraderAccountId)) return null

  return new CTraderClient({
    host, clientId, clientSecret, accessToken, refreshToken, ctidTraderAccountId,
  })
}
