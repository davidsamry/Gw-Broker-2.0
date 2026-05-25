// cTrader Open API client — STUB in F1.
//
// Will be filled in F2 with:
//   • WebSocket connection to wss://{demo|live}.ctraderapi.com:5036
//   • Protobuf encoding/decoding (vendored .proto schemas, codec via
//     protobufjs)
//   • OAuth2 token refresh
//   • Heartbeat (PingReq every 10s; provider closes after ~30s silence)
//   • Reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s cap)
//   • Subscription state recovery on reconnect (rebuilds the subscribe set)
//   • Symbol map population via ProtoOASymbolsListReq at handshake
//
// Until F2, this stub keeps the runtime importable and exposes the
// MarketProvider surface so the rest of the module can wire up against it.
// `start()` resolves immediately in INITIAL state — no socket is opened.

import type {
  MarketProvider, ProviderEvents, ProviderStatus,
} from '../types.js'
import type { ForexAssetConfig } from '../../types.js'

export interface CTraderConfig {
  /** 'demo.ctraderapi.com' or 'live.ctraderapi.com'. Demo recommended for
   *  initial setup — same protocol, different account scope. */
  host:         string
  /** OAuth2 application credentials from openapi.ctrader.com */
  clientId:     string
  clientSecret: string
  /** Access token issued for a specific trading account. Refreshed via
   *  refreshToken when it expires (~30 days). */
  accessToken:  string
  refreshToken: string
  /** ctidTraderAccountId — broker's internal account id, NOT the account
   *  number shown in cTrader desktop. Returned by GetAccountListByAccess
   *  TokenReq. */
  ctidTraderAccountId: number
}

export class CTraderClient implements MarketProvider {
  readonly name = 'ctrader'
  private status: ProviderStatus = 'INITIAL'

  constructor(private config: CTraderConfig) {}

  async start(_assets: ForexAssetConfig[], events: ProviderEvents): Promise<void> {
    // F2 will: open WS, send ProtoOAVersionReq, ProtoOAApplicationAuthReq,
    // ProtoOAAccountAuthReq, ProtoOASymbolsListReq, then resolve.
    console.log('[forex/ctrader] STUB — start() called; F2 will wire the real connection')
    this.status = 'INITIAL'
    events.onStatus(this.status, 'F1 stub — no live connection yet')
  }

  async subscribe(_assetId: string): Promise<void> {
    // F2: send ProtoOASubscribeSpotsReq for the asset's ctraderSymbolId.
  }

  async unsubscribe(_assetId: string): Promise<void> {
    // F2: send ProtoOAUnsubscribeSpotsReq.
  }

  async stop(): Promise<void> {
    this.status = 'STOPPED'
  }

  getStatus(): ProviderStatus {
    return this.status
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      provider: 'ctrader',
      stage:    'F1 stub',
      host:     this.config.host,
      // never log secrets — only the presence flag
      hasCreds: !!(this.config.clientId && this.config.clientSecret && this.config.accessToken),
    }
  }
}

/** Build a cTrader client from environment variables. Returns null when any
 *  required env is missing — the runtime then falls back to no-op mode so
 *  the rest of the forex module still boots (admin status / REST endpoints
 *  / WS server all work; no live ticks). */
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
