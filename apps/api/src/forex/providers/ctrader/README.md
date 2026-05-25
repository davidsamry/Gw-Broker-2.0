# cTrader Open API provider

Stage: **F1 (scaffolding)** — the client is a stub. Real connection lands
in F2 once we have credentials.

## Required environment variables (F2 onwards)

```env
CTRADER_HOST=demo.ctraderapi.com
CTRADER_CLIENT_ID=...
CTRADER_CLIENT_SECRET=...
CTRADER_ACCESS_TOKEN=...
CTRADER_REFRESH_TOKEN=...
CTRADER_CTID_TRADER_ACCOUNT_ID=...
```

All six required. If any is missing, `tryCreateCTraderClient()` returns
`null` and the runtime boots in no-op mode (status page works, REST works,
WS works — just no live ticks).

## How to get credentials

1. Open a demo account at any cTrader broker (IC Markets, Pepperstone,
   FxPro, Spotware demo).
2. Visit https://openapi.ctrader.com, log in with the broker account.
3. **Applications** → New Application.
   - Redirect URI: any localhost URL works for demo (e.g. `http://localhost:3000/ctrader-callback`).
   - Permissions: **Trading** (gives you market data + trading; for
     market-data-only we still need this scope per their API design).
   - Save → copy `CLIENT_ID` + `CLIENT_SECRET`.
4. On the same page, **Get Tokens** → authorise → copy `ACCESS_TOKEN`
   and `REFRESH_TOKEN`.
5. Get `CTID_TRADER_ACCOUNT_ID`:
   - In cTrader desktop, look at the account number visible in the
     bottom-right.
   - OR call `ProtoOAGetAccountListByAccessTokenReq` once with your
     access token to list accounts; pick the demo's `ctidTraderAccountId`.
6. Drop everything into `.env` (local) and EasyPanel env vars (prod).

## What the client will do in F2

- WS connect to `wss://{host}:5036` (TLS, binary protobuf frames).
- `ProtoOAApplicationAuthReq` with clientId/clientSecret.
- `ProtoOAAccountAuthReq` with access token + ctidTraderAccountId.
- `ProtoOAGetSymbolsListReq` → resolve `EURUSD → symbolId 1`, etc.
  Cache the mapping in `forex_assets.ctraderSymbolId`.
- `ProtoOASubscribeSpotsReq` per asset.
- Heartbeat: `ProtoOAPingReq` every 10s. Provider closes the socket after
  ~30s silence — keep it warm.
- Reconnect: exponential backoff 1s → 2s → 4s → 8s → 16s → 30s cap.
  On every successful reconnect, replay the full subscription list.
- Refresh token automatically before expiry (~30d).

## What this module DOES NOT do

- Trade execution. We're using cTrader purely as a quote feed.
- Account balance sync. Not relevant for our use case.
- Historical candles via REST. cTrader has a `ProtoOAGetTrendbarsReq` but
  we prefer to build our own candles from ticks so the timing is
  perfectly aligned with what users see live.
