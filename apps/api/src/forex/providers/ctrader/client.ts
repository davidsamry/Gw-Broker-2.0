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

// Loose type — the library declares CTraderLayerEvent as `{}` so all
// payload fields are technically optional from the library's perspective.
// cTrader actually serialises ints as STRINGS via protobufjs JSON, so we
// also accept strings for any numeric-looking field.
interface SpotEvent {
  symbolId?:  number | string
  bid?:       number | string
  ask?:       number | string
  timestamp?: number | string
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

      // Wire spot event handler BEFORE open() so we don't miss the first
      // events after subscribe. Cast: library types every event as the
      // empty object `{}`; actual shape is documented in SpotEvent above.
      this.connection.on('ProtoOASpotEvent', (event: any) => this.handleSpotEvent(event as SpotEvent))

      // Debug listeners — log notable events so we can see what's arriving
      // when ticks don't show up. Remove once tick stream is stable.
      this.connection.on('ProtoOAClientDisconnectEvent', (e: any) => {
        this.log(`server disconnect: ${JSON.stringify(e).slice(0, 200)}`)
      })
      this.connection.on('ProtoOAAccountsTokenInvalidatedEvent', (e: any) => {
        this.log(`token invalidated: ${JSON.stringify(e).slice(0, 200)}`)
      })
      this.connection.on('ProtoHeartbeatEvent', () => {
        this.log('<<< heartbeat from server')
      })
      this.connection.on('ProtoOASymbolChangedEvent', (e: any) => {
        this.log(`symbol changed: ${JSON.stringify(e).slice(0, 200)}`)
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
      if (ids.length > 0) {
        const subRes = await this.connection.sendCommand('ProtoOASubscribeSpotsReq', {
          ctidTraderAccountId: this.config.ctidTraderAccountId,
          symbolId: ids,
        })
        this.log(`subscribed to ${ids.length} symbols, response: ${JSON.stringify(subRes).slice(0, 200)}`)
      } else {
        this.log('WARNING: no symbols matched — nothing to subscribe to')
      }

      // Debug: probe the account with ProtoOATraderReq to confirm we have
      // active account access. If this fails or returns empty, the demo
      // account likely lacks broker association or market data permission.
      try {
        const trader = await this.connection.sendCommand('ProtoOATraderReq', {
          ctidTraderAccountId: this.config.ctidTraderAccountId,
        })
        this.log(`trader profile OK: ${JSON.stringify(trader).slice(0, 300)}`)
      } catch (err) {
        this.log(`trader probe FAILED: ${(err as Error).message}`)
      }

      // Probe: request 10 most recent M1 candles for the first symbol.
      // Confirms whether the account has historical market data access.
      const firstSymId = ids[0]
      if (firstSymId) {
        try {
          const now = Date.now()
          const bars = await this.connection.sendCommand('ProtoOAGetTrendbarsReq', {
            ctidTraderAccountId: this.config.ctidTraderAccountId,
            symbolId:            firstSymId,
            period:              'M1',
            fromTimestamp:       now - 60 * 60 * 1000,
            toTimestamp:         now,
            count:               10,
          })
          const summary = JSON.stringify(bars).slice(0, 300)
          this.log(`trendbars probe (symbolId=${firstSymId}): ${summary}`)
        } catch (err) {
          this.log(`trendbars probe FAILED: ${(err as Error).message}`)
        }
      }

      // 5. Heartbeat loop — also doubles as a connection-alive check.
      //    If sendHeartbeat throws, we treat it as a disconnect and reconnect.
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

  // ── Spot event handling ───────────────────────────────────────────────

  private firstEventLogged = false

  private handleSpotEvent(event: SpotEvent): void {
    // One-time dump of the raw event so we can see exactly what types
    // cTrader sends (string vs number for symbolId/bid/ask).
    if (!this.firstEventLogged) {
      this.firstEventLogged = true
      this.log(`first spot event raw: ${JSON.stringify(event)}`)
    }

    const symbolId = Number(event.symbolId)
    if (!Number.isFinite(symbolId)) return

    // Reverse lookup: symbolId → assetId
    let assetId: string | null = null
    let digits = 5
    for (const a of this.assets) {
      if (this.symbolMap.get(a.id) === symbolId) {
        assetId = a.id
        digits = a.digits
        break
      }
    }
    if (!assetId) return

    // cTrader sends bid/ask scaled by 10^digits as int64 — serialised as
    // STRING by the protobuf JSON encoder. Coerce robustly.
    const scale = Math.pow(10, digits)
    const bidRaw = (event as any).bid
    const askRaw = (event as any).ask
    const bidNum = bidRaw != null ? Number(bidRaw) : NaN
    const askNum = askRaw != null ? Number(askRaw) : NaN
    const bid = Number.isFinite(bidNum) ? bidNum / scale : null
    const ask = Number.isFinite(askNum) ? askNum / scale : null
    if (bid == null && ask == null) return

    const mid = (bid != null && ask != null) ? (bid + ask) / 2 : (bid ?? ask ?? 0)
    const now = Date.now()

    this.lastTickAt = now
    this.ticksReceived++

    // F2: log to console for visibility. F3 will hand the same stream
    // to the candle aggregator instead of logging.
    console.log(
      `[forex/ctrader] tick ${assetId}` +
      ` bid=${bid?.toFixed(digits) ?? '—'}` +
      ` ask=${ask?.toFixed(digits) ?? '—'}` +
      ` mid=${mid.toFixed(digits)}`,
    )

    this.events?.onTick({
      assetId,
      bid:       bid ?? mid,
      ask:       ask ?? mid,
      mid,
      timestamp: now,
    })
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
