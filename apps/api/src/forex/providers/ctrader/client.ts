// cTrader Open API client — JSON over WebSocket (port 5035).
//
// Protocol reference: https://help.ctrader.com/open-api/
//
// Connection lifecycle:
//   open  → ProtoOAVersionReq         (2104)
//         → ProtoOAApplicationAuthReq (2100)
//         → ProtoOAAccountAuthReq     (2102)
//         → ProtoOASymbolsListReq     (2114) — map our pairs to symbolIds
//         → ProtoOASubscribeSpotsReq  (2127) per asset
//   stream← ProtoOASpotEvent          (2131) at every tick
//   keep ← ProtoHeartbeatEvent        (51)   every 10s (we send + receive)
//   close → reconnect with exponential backoff (1s..30s cap)
//
// The provider stays opaque to the rest of the forex module: it speaks
// only to MarketProvider hooks (onTick / onStatus / onError). When the
// socket drops, the runtime sees a status change but doesn't have to do
// anything — reconnection is handled here.

import { randomUUID } from 'node:crypto'
import type {
  MarketProvider, ProviderEvents, ProviderStatus,
} from '../types.js'
import type { ForexAssetConfig } from '../../types.js'
import { prisma } from '../../../prisma.js'

// ── cTrader payload type constants ──────────────────────────────────────────
const PT_HEARTBEAT_EVENT          = 51
const PT_APPLICATION_AUTH_REQ     = 2100
const PT_APPLICATION_AUTH_RES     = 2101
const PT_ACCOUNT_AUTH_REQ         = 2102
const PT_ACCOUNT_AUTH_RES         = 2103
const PT_VERSION_REQ              = 2104
const PT_VERSION_RES              = 2105
const PT_SYMBOLS_LIST_REQ         = 2114
const PT_SYMBOLS_LIST_RES         = 2115
const PT_SUBSCRIBE_SPOTS_REQ      = 2127
const PT_SUBSCRIBE_SPOTS_RES      = 2128
const PT_SPOT_EVENT               = 2131
const PT_ERROR_RES                = 2142

const HEARTBEAT_INTERVAL_MS  = 10_000
const RECONNECT_BACKOFFS_MS  = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

export interface CTraderConfig {
  /** 'demo.ctraderapi.com' or 'live.ctraderapi.com'. */
  host:                string
  /** OAuth2 application credentials from openapi.ctrader.com */
  clientId:            string
  clientSecret:        string
  /** Access token issued for a specific trading account. */
  accessToken:         string
  /** Refresh token — currently unused (F2 doesn't refresh; we'll add the
   *  refresh dance when tokens start expiring in production). */
  refreshToken:        string
  /** ctidTraderAccountId — broker's internal account id, returned by
   *  GetAccountListByAccessTokenReq when you authorise the app. NOT the
   *  account number shown in cTrader desktop. */
  ctidTraderAccountId: number
}

interface CTraderEnvelope {
  clientMsgId?: string
  payloadType:  number
  payload?:     unknown
}

interface CTraderError {
  errorCode?:    string
  description?:  string
}

export class CTraderClient implements MarketProvider {
  readonly name = 'ctrader'
  private status: ProviderStatus = 'INITIAL'

  private ws:        WebSocket | null = null
  private events:    ProviderEvents | null = null
  private assets:    ForexAssetConfig[]     = []
  /** Map<assetId → ctraderSymbolId> built after SymbolsList. */
  private symbolMap: Map<string, number>    = new Map()

  // Connection lifecycle bookkeeping
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout>  | null = null
  private reconnectStep   = 0
  private intentionalClose = false

  // Stats (surfaced via getDebugInfo for the admin panel)
  private connectedAt:        number | null = null
  private lastTickAt:         number | null = null
  private ticksReceived       = 0
  private reconnectCount      = 0
  private lastErrorMessage:   string | null = null

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
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
    this.setStatus('STOPPED')
  }

  async subscribe(assetId: string): Promise<void> {
    const symbolId = this.symbolMap.get(assetId)
    if (!symbolId) { this.log(`subscribe: no symbolId for ${assetId} (not in map yet?)`); return }
    this.send({
      payloadType: PT_SUBSCRIBE_SPOTS_REQ,
      payload: {
        ctidTraderAccountId: this.config.ctidTraderAccountId,
        symbolId: [symbolId],
      },
    })
  }

  async unsubscribe(_assetId: string): Promise<void> {
    // F2: not used. Subscriptions persist for the connection's lifetime.
    // F3+ may need this if admin disables an asset live.
  }

  getStatus(): ProviderStatus { return this.status }

  getDebugInfo(): Record<string, unknown> {
    return {
      provider:        'ctrader',
      host:            this.config.host,
      ctidTraderAcct:  this.config.ctidTraderAccountId,
      status:          this.status,
      connectedAt:     this.connectedAt,
      lastTickAt:      this.lastTickAt,
      ticksReceived:   this.ticksReceived,
      reconnectCount:  this.reconnectCount,
      symbolMap:       Object.fromEntries(this.symbolMap),
      lastError:       this.lastErrorMessage,
    }
  }

  // ── Connection ─────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.intentionalClose) return
    this.setStatus(this.reconnectStep > 0 ? 'RECONNECTING' : 'CONNECTING')

    // cTrader JSON Open API endpoint. Port 5035 (JSON), 5036 (Protobuf).
    const url = `wss://${this.config.host}:5035`
    this.log(`connecting to ${url}`)

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err: any) {
      this.recordError(err?.message ?? 'WebSocket constructor threw')
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.addEventListener('open',    () => this.onOpen())
    ws.addEventListener('message', (e) => this.onMessage(e))
    ws.addEventListener('error',   (e: any) => {
      this.recordError(e?.message ?? 'socket error')
    })
    ws.addEventListener('close',   (e: any) => this.onClose(e?.code, e?.reason))
  }

  private async onOpen(): Promise<void> {
    this.log('socket open — beginning handshake')
    this.connectedAt = Date.now()
    try {
      // 1. Version handshake — confirms protocol compat. cTrader will
      //    drop the connection if our version is too old/new.
      const ver = await this.request<{ version?: { major: number; minor: number; patch: number } }>(
        PT_VERSION_REQ, {}, PT_VERSION_RES,
      )
      const v = ver?.version
      this.log(`server version: ${v ? `${v.major}.${v.minor}.${v.patch}` : 'unknown'}`)

      // 2. Application auth — proves we own the OAuth app.
      await this.request(PT_APPLICATION_AUTH_REQ, {
        clientId:     this.config.clientId,
        clientSecret: this.config.clientSecret,
      }, PT_APPLICATION_AUTH_RES)
      this.log('application authenticated')

      // 3. Account auth — proves we have access to the user's account.
      await this.request(PT_ACCOUNT_AUTH_REQ, {
        ctidTraderAccountId: this.config.ctidTraderAccountId,
        accessToken:         this.config.accessToken,
      }, PT_ACCOUNT_AUTH_RES)
      this.log(`account ${this.config.ctidTraderAccountId} authenticated`)

      this.setStatus('AUTHED')

      // 4. Symbols list → map our 5 pairs to cTrader's internal IDs.
      const list = await this.request<{ symbol?: Array<{ symbolId: number; symbolName: string; enabled: boolean }> }>(
        PT_SYMBOLS_LIST_REQ,
        { ctidTraderAccountId: this.config.ctidTraderAccountId },
        PT_SYMBOLS_LIST_RES,
      )
      await this.mapSymbols(list?.symbol ?? [])

      // 5. Subscribe to spots for every asset that mapped successfully.
      const subscribed: number[] = []
      for (const a of this.assets) {
        const id = this.symbolMap.get(a.id)
        if (id) subscribed.push(id)
      }
      if (subscribed.length > 0) {
        this.send({
          payloadType: PT_SUBSCRIBE_SPOTS_REQ,
          payload: {
            ctidTraderAccountId: this.config.ctidTraderAccountId,
            symbolId: subscribed,
          },
        })
        this.log(`subscribed to ${subscribed.length} symbols`)
      } else {
        this.log('WARNING: no symbols matched — nothing to subscribe to')
      }

      // 6. Start heartbeats — cTrader drops the connection after ~30s
      //    of silence, and the handshake itself counts as activity, so
      //    we have a comfortable buffer before the first heartbeat.
      this.startHeartbeat()

      // Reset reconnect backoff on a clean connection.
      this.reconnectStep = 0
    } catch (err: any) {
      this.recordError(`handshake failed: ${err?.message ?? err}`)
      try { this.ws?.close() } catch { /* ignore */ }
    }
  }

  private onMessage(e: MessageEvent): void {
    let msg: CTraderEnvelope
    try {
      msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data))
    } catch (err) {
      this.log(`malformed message dropped: ${err}`)
      return
    }

    // clientMsgId routing — wakes the pending request() promise.
    if (msg.clientMsgId && this.pendingRequests.has(msg.clientMsgId)) {
      const pending = this.pendingRequests.get(msg.clientMsgId)!
      this.pendingRequests.delete(msg.clientMsgId)
      if (msg.payloadType === PT_ERROR_RES) {
        const e = (msg.payload ?? {}) as CTraderError
        pending.reject(new Error(`cTrader error ${e.errorCode}: ${e.description}`))
      } else if (pending.expect && msg.payloadType !== pending.expect) {
        pending.reject(new Error(`expected payload type ${pending.expect}, got ${msg.payloadType}`))
      } else {
        pending.resolve(msg.payload)
      }
      return
    }

    // Unsolicited events (no clientMsgId or unknown id).
    switch (msg.payloadType) {
      case PT_SPOT_EVENT:
        this.handleSpotEvent(msg.payload as Record<string, unknown>)
        break
      case PT_HEARTBEAT_EVENT:
        // Server pings us back — nothing to do; ours is on a timer.
        break
      case PT_ERROR_RES: {
        const err = (msg.payload ?? {}) as CTraderError
        this.recordError(`server error ${err.errorCode}: ${err.description}`)
        break
      }
      default:
        // Unknown unsolicited event — log at low priority for visibility.
        this.log(`unhandled message payloadType=${msg.payloadType}`)
    }
  }

  private onClose(code?: number, reason?: string): void {
    this.log(`socket closed code=${code} reason=${reason ?? ''}`)
    this.ws = null
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.intentionalClose) {
      this.setStatus('STOPPED')
      return
    }
    this.reconnectCount++
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
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
      this.send({ payloadType: PT_HEARTBEAT_EVENT })
    }, HEARTBEAT_INTERVAL_MS)
  }

  // ── Symbol mapping ────────────────────────────────────────────────────

  private async mapSymbols(symbols: Array<{ symbolId: number; symbolName: string; enabled: boolean }>): Promise<void> {
    // cTrader returns symbols like "EURUSD" or "EUR/USD" depending on
    // broker. Normalize on both sides so the match isn't slash-sensitive.
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '')
    const byNormalized = new Map<string, number>()
    for (const s of symbols) {
      if (!s.enabled) continue
      byNormalized.set(norm(s.symbolName), s.symbolId)
    }

    this.symbolMap.clear()
    const updates: Array<{ id: string; symbolId: number }> = []
    for (const asset of this.assets) {
      const id = byNormalized.get(norm(asset.symbol))
      if (id != null) {
        this.symbolMap.set(asset.id, id)
        updates.push({ id: asset.id, symbolId: id })
      } else {
        this.log(`WARNING: symbol "${asset.symbol}" not found in cTrader catalog`)
      }
    }

    // Persist the mapping so a restart can subscribe without waiting for
    // the SymbolsList round-trip (though we still re-fetch on every boot
    // to detect upstream changes).
    for (const u of updates) {
      try {
        await prisma.$executeRaw`
          UPDATE forex_assets SET "ctraderSymbolId" = ${u.symbolId} WHERE id = ${u.id}
        `
      } catch (err) {
        this.log(`failed to persist symbolId for ${u.id}: ${err}`)
      }
    }
    this.log(`symbol map built: ${updates.length}/${this.assets.length} pairs mapped`)
  }

  // ── Spot event handling ────────────────────────────────────────────────

  private handleSpotEvent(payload: Record<string, unknown>): void {
    const symbolId = Number(payload.symbolId)
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

    // Bid/ask come scaled by 10^digits (integer). Some spots arrive with
    // only bid or only ask — pass through whatever's set; null otherwise.
    const scale = Math.pow(10, digits)
    const bidRaw = payload.bid as number | undefined
    const askRaw = payload.ask as number | undefined
    const bid = typeof bidRaw === 'number' ? bidRaw / scale : null
    const ask = typeof askRaw === 'number' ? askRaw / scale : null
    if (bid == null && ask == null) return

    // Midpoint preferred; fall back to whichever side we have.
    const mid = (bid != null && ask != null) ? (bid + ask) / 2 : (bid ?? ask ?? 0)
    const now = Date.now()

    this.lastTickAt = now
    this.ticksReceived++

    // F2 logs to console; F3 hands to the aggregator instead.
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

  // ── Request/response correlation ──────────────────────────────────────

  private pendingRequests = new Map<string, {
    resolve: (v: any) => void
    reject:  (e: Error) => void
    expect?: number
  }>()

  /** Send a request and await the matching response. Reject after 10s
   *  to avoid hanging the handshake if the server drops the reply. */
  private request<T = unknown>(payloadType: number, payload: unknown, expect?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const clientMsgId = randomUUID()
      const timer = setTimeout(() => {
        this.pendingRequests.delete(clientMsgId)
        reject(new Error(`request ${payloadType} timed out`))
      }, 10_000)
      this.pendingRequests.set(clientMsgId, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T) },
        reject:  (e) => { clearTimeout(timer); reject(e) },
        expect,
      })
      this.send({ clientMsgId, payloadType, payload })
    })
  }

  private send(env: CTraderEnvelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(env))
    } catch (err) {
      this.log(`send failed: ${err}`)
    }
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

/** Build a cTrader client from environment variables. Returns null when any
 *  required env is missing — the runtime then falls back to no-op mode so
 *  the rest of the forex module still boots. */
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
