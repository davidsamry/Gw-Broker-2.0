# GW Broker — Bot API

REST API para bots externos, automações e ferramentas de terceiros operarem na plataforma GW Broker. Esta documentação descreve **exatamente** o que está implementado no backend hoje (path real, payloads reais, códigos de erro reais).

Use este documento como spec autoritativo para construir:

- Dashboards de bot (Next.js / React)
- SDK em qualquer linguagem (JavaScript, Python, Go, etc.)
- Painéis administrativos integrados
- Testers / "API Playground"
- Sites de documentação pública

---

## Sumário

1. [Visão geral](#visão-geral)
2. [Base URL & ambientes](#base-url--ambientes)
3. [Autenticação](#autenticação)
4. [Formato de respostas e erros](#formato-de-respostas-e-erros)
5. [Rate limiting](#rate-limiting)
6. [Modelo de dados](#modelo-de-dados)
7. [Endpoints](#endpoints)
   - 7.1 [POST /bot/v1/login](#71-post-botv1login)
   - 7.2 [POST /bot/v1/refresh](#72-post-botv1refresh)
   - 7.3 [GET /bot/v1/profile](#73-get-botv1profile)
   - 7.4 [GET /bot/v1/balance](#74-get-botv1balance)
   - 7.5 [GET /bot/v1/assets](#75-get-botv1assets)
   - 7.6 [POST /bot/v1/trade](#76-post-botv1trade)
   - 7.7 [GET /bot/v1/trades](#77-get-botv1trades)
   - 7.8 [GET /bot/v1/trade/:id](#78-get-botv1tradeid)
8. [Regras de negócio importantes](#regras-de-negócio-importantes)
9. [Fluxos completos](#fluxos-completos)
10. [Códigos de erro — tabela completa](#códigos-de-erro--tabela-completa)
11. [Notas para implementação de cliente](#notas-para-implementação-de-cliente)

---

## Visão geral

- **Stack do servidor**: Fastify 5 (Node.js, ESM) + Prisma 6 + PostgreSQL.
- **Mount path**: todas as rotas estão sob o prefixo `/bot/v1/`.
- **Estilo**: REST com JSON. Campos de payload e resposta usam **snake_case** (diferente do resto da API web, que usa camelCase).
- **Auth**: Bearer token JWT no header `Authorization`.
- **Conta operada**: bot sempre opera na conta **REAL** do usuário (a conta DEMO existe na plataforma mas o bot não tem acesso a ela).
- **2FA**: bypassado nesta API (decisão de produto). 2FA continua obrigatório no login web.
- **Versionamento**: o `/v1` faz parte do path. Mudanças incompatíveis criam `/v2`, sem quebrar bots em produção.

---

## Base URL & ambientes

| Ambiente | URL base                              |
| -------- | ------------------------------------- |
| Local    | `http://localhost:3001/bot/v1`        |
| Produção | `https://api.gwbroker.com.br/bot/v1`  |

> O domínio de produção pode ser ajustado pelo time de infra — confira sempre a URL ativa no painel admin em `/admin/api`.

**CORS**: a API aceita requisições de qualquer origem (sem cookies enviados — bots usam header `Authorization`, não cookie). `credentials: true` está ligado no Fastify CORS mas só é necessário para o frontend web.

---

## Autenticação

### Modelo de token

A API emite **dois tokens** no login:

| Token             | Tipo            | TTL    | Onde guardar              | Para que serve                                  |
| ----------------- | --------------- | ------ | ------------------------- | ----------------------------------------------- |
| `access_token`    | JWT             | 1 hora | RAM (ou storage seguro)   | Header `Authorization: Bearer <token>` em cada chamada |
| `refresh_token`   | String opaca    | 30 dias| Storage seguro (encrypted)| Trocar por um novo `access_token` quando expirar |

### Detalhes técnicos

- **Access token**: JWT assinado com `JWT_SECRET` (mesmo segredo da web). Claims:
  ```json
  { "sub": "<user-id>", "kind": "bot", "exp": <unix-ts>, "iat": <unix-ts> }
  ```
  O claim `kind: "bot"` impede que um token web seja reutilizado em rotas do bot — o middleware rejeita tokens sem essa marca com `401 UNAUTHORIZED`.

- **Refresh token**: 32 bytes aleatórios (256 bits) codificados em base64url. **Apenas o hash SHA-256** é persistido no banco (`bot_refresh_tokens.tokenHash`). Se o banco vazar, sessões ativas continuam seguras.

- **Rotação**: cada chamada ao `/refresh` revoga o token anterior (`revokedAt = NOW()`) e emite um par novo. Isso significa:
  - Se você usar o mesmo refresh_token duas vezes, a segunda falha.
  - Sempre persista o `refresh_token` que vem na resposta do `/refresh`.
  - Se um refresh falha com `REFRESH_INVALID`, faça login de novo (não tente outra vez).

### Como enviar o token

Todas as rotas autenticadas exigem:

```
Authorization: Bearer <access_token>
```

Exemplo:

```bash
curl -H "Authorization: Bearer eyJhbGciOi..." https://api.gwbroker.com.br/bot/v1/balance
```

### Erros de autenticação

| Cenário                                        | HTTP | `error`           |
| ---------------------------------------------- | ---- | ----------------- |
| Sem header `Authorization`                     | 401  | `UNAUTHORIZED`    |
| JWT inválido / expirado                        | 401  | `UNAUTHORIZED`    |
| JWT válido mas sem claim `kind:"bot"`          | 401  | `UNAUTHORIZED`    |
| Usuário do JWT foi deletado                    | 401  | `UNAUTHORIZED`    |
| Conta foi bloqueada pelo admin                 | 403  | `ACCOUNT_BLOCKED` |
| Refresh token revogado / expirado / não existe | 401  | `REFRESH_INVALID` |

---

## Formato de respostas e erros

### Sucesso

Cada endpoint tem sua própria forma — documentada por endpoint abaixo. Padrão:

```json
{ "success": true, "...": "..." }
```

Alguns endpoints (`/balance`, `/profile`, `/assets`, `/trades`, `/trade/:id`) omitem o campo `success` e retornam o objeto direto.

### Erro

Todos os erros seguem este shape:

```json
{ "error": "CODE_EM_MAIUSCULAS", "details": { ... opcional ... } }
```

- `error` é sempre uma string `SNAKE_CASE_MAIUSCULO`.
- `details` aparece quando o erro vem da validação Zod e contém o output de `zod.flatten()`.
- O HTTP status code complementa o `error` — 400 (validação), 401 (auth), 403 (bloqueado), 404 (não existe), 429 (rate limit), 500 (servidor).

Ver a [tabela completa de códigos](#códigos-de-erro--tabela-completa) ao final.

---

## Rate limiting

| Endpoint                                         | Limite                       | Comportamento                                                                       |
| ------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------- |
| `POST /login`                                    | **5 tentativas falhadas / 5 min / IP** | Após 5 falhas: `429 RATE_LIMIT_EXCEEDED`. Login bem-sucedido **zera** o contador. |
| `POST /trade`                                    | Min interval configurável (default 1000ms entre trades / usuário) | `429 TOO_FAST` se as trades vierem rápido demais. |
| Demais endpoints                                 | Sem rate limit dedicado      | Limitados pela CPU + I/O do Fastify (deve aguentar ~1000 req/s).                    |

### Headers de resposta

Quando rate-limit dispara em `/login`, a resposta inclui:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 287
Content-Type: application/json

{ "error": "RATE_LIMIT_EXCEEDED", "retry_after": 287 }
```

Use `Retry-After` (em segundos) para saber quando tentar de novo.

---

## Modelo de dados

### `Profile`

```ts
{
  user_id:             string         // UUID
  email:               string
  first_name:          string         // derivado de `name` se `lastName` vazio
  last_name:           string         // idem
  full_name:           string
  phone:               string | null
  cpf:                 string | null  // 11 dígitos, sem máscara
  balance:             number         // saldo REAL (BRL)
  demo_balance:        number         // saldo DEMO (BRL) — informativo, bot não opera DEMO
  bonus:               number         // saldo bonus REAL (BRL)
  rollover_required:   number         // total que precisa girar pra liberar saque
  rollover_completed:  number         // progresso atual de rollover
  is_blocked:          boolean
  verification_status: "approved" | "pending" | "rejected" | "not_submitted"
  created_at:          string         // ISO 8601
}
```

### `Balance`

```ts
{
  balance:            number   // saldo REAL
  bonus:              number   // saldo bonus
  rollover_required:  number
  rollover_completed: number
}
```

### `Asset`

```ts
{
  symbol:    string   // ex: "BTCUSDT" — sempre maiúscula, sem barra
  name:      string   // ex: "Bitcoin / USDT"
  category:  "crypto" | "forex" | "otc" | "other"
  payout:    number   // % de lucro se acertar (ex: 95 = +95% sobre o stake)
  is_active: true     // só ativos ativos retornam — campo presente por compatibilidade
}
```

### `Trade`

```ts
{
  id:                string              // UUID — use em /trade/:id
  symbol:            string              // ex: "BTCUSDT"
  direction:         "up" | "down"       // "up" = CALL (preço sobe), "down" = PUT (preço cai)
  stake:             number              // valor apostado (BRL)
  entry_price:       number              // preço do ativo no momento da abertura
  exit_price:        number | null       // preço na expiração — null enquanto OPEN
  payout_percentage: number              // % do payout no momento da abertura
  result:            "win" | "loss" | "refund" | null   // null enquanto OPEN; "refund" = cancelada (estorno)
  profit:            number              // BRL ganhos — 0 se perdeu/cancelou/aberta
  status:            "open" | "closed"
  created_at:        string              // ISO 8601 — abertura
  expires_at:        string              // ISO 8601 — quando expira
  closed_at:         string | null       // ISO 8601 — quando foi resolvida
}
```

### `Direction`

Internamente: `CALL` (preço sobe) e `PUT` (preço cai). Na API do bot:

| Bot API | Significado     | Equivalente interno |
| ------- | --------------- | ------------------- |
| `"up"`  | Preço vai subir | `CALL`              |
| `"down"`| Preço vai cair  | `PUT`               |

### `duration_seconds` permitidos

Apenas 3 valores são aceitos no `POST /trade`:

| Valor | Significado |
| ----- | ----------- |
| `60`  | 1 minuto    |
| `300` | 5 minutos   |
| `900` | 15 minutos  |

Qualquer outro valor → `400 VALIDATION_ERROR`.

---

## Endpoints

### 7.1 POST /bot/v1/login

Autentica com email + senha e devolve um par de tokens.

**Auth**: ❌ Não requer

**Body**

```json
{
  "email": "trader@example.com",
  "password": "senhaForte123"
}
```

| Campo      | Tipo   | Regra                                 |
| ---------- | ------ | ------------------------------------- |
| `email`    | string | Email válido. Lowercased + trimmed.   |
| `password` | string | 1–72 caracteres.                      |

**200 Sucesso**

```json
{
  "success": true,
  "access_token": "eyJhbGciOi...",
  "refresh_token": "8X7sQ3...",
  "expires_in": 3600,
  "user": {
    "id": "ckl...",
    "email": "trader@example.com"
  }
}
```

- `expires_in`: TTL do access_token em segundos (sempre `3600` = 1h).
- O `refresh_token` deve ser persistido com segurança.

**Erros**

| HTTP | `error`                  | Quando                                                |
| ---- | ------------------------ | ----------------------------------------------------- |
| 400  | `VALIDATION_ERROR`       | Body fora do schema.                                  |
| 401  | `INVALID_CREDENTIALS`    | Email não existe ou senha errada.                     |
| 403  | `ACCOUNT_BLOCKED`        | Conta foi bloqueada pelo admin.                       |
| 429  | `RATE_LIMIT_EXCEEDED`    | 5+ tentativas falhadas em 5min do mesmo IP. Inclui `retry_after`. |

**Exemplo cURL**

```bash
curl -X POST https://api.gwbroker.com.br/bot/v1/login \
  -H "Content-Type: application/json" \
  -d '{"email":"trader@example.com","password":"senhaForte123"}'
```

**Exemplo JavaScript**

```js
const res = await fetch('https://api.gwbroker.com.br/bot/v1/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const { access_token, refresh_token } = await res.json()
```

---

### 7.2 POST /bot/v1/refresh

Troca um `refresh_token` válido por um novo par. O refresh antigo é revogado.

**Auth**: ❌ Não requer (o próprio refresh_token é a credencial)

**Body**

```json
{
  "refresh_token": "8X7sQ3..."
}
```

| Campo           | Tipo   | Regra            |
| --------------- | ------ | ---------------- |
| `refresh_token` | string | Mínimo 20 chars  |

**200 Sucesso**

```json
{
  "success": true,
  "access_token": "eyJhbGciOi...",
  "refresh_token": "novoTokenAqui...",
  "expires_in": 3600
}
```

**⚠️ Importante**: o `refresh_token` antigo **NÃO funciona mais**. Substitua imediatamente no storage do seu bot.

**Erros**

| HTTP | `error`            | Quando                                            |
| ---- | ------------------ | ------------------------------------------------- |
| 400  | `VALIDATION_ERROR` | Body inválido.                                    |
| 401  | `REFRESH_INVALID`  | Token não existe, foi revogado ou expirou (30 dias). |

---

### 7.3 GET /bot/v1/profile

Retorna dados completos do usuário autenticado.

**Auth**: ✅ Bearer access_token

**200 Sucesso**

```json
{
  "user_id": "ckl...",
  "email": "trader@example.com",
  "first_name": "João",
  "last_name": "Silva",
  "full_name": "João Silva",
  "phone": "+5511999999999",
  "cpf": "12345678901",
  "balance": 1500.50,
  "demo_balance": 10000.00,
  "bonus": 0,
  "rollover_required": 0,
  "rollover_completed": 0,
  "is_blocked": false,
  "verification_status": "approved",
  "created_at": "2026-01-15T10:30:00.000Z"
}
```

**Erros**: `401 UNAUTHORIZED`, `403 ACCOUNT_BLOCKED`, `404 USER_NOT_FOUND`.

---

### 7.4 GET /bot/v1/balance

Endpoint leve para checar saldo + estado de rollover (sem trazer perfil inteiro).

**Auth**: ✅ Bearer access_token

**200 Sucesso**

```json
{
  "balance": 1500.50,
  "bonus": 0,
  "rollover_required": 0,
  "rollover_completed": 0
}
```

**Erros**: `401 UNAUTHORIZED`, `403 ACCOUNT_BLOCKED`.

---

### 7.5 GET /bot/v1/assets

Lista os ativos disponíveis para trade. Aplica filtros de admin (ativos desabilitados não aparecem; payouts customizados são considerados).

**Auth**: ✅ Bearer access_token

**200 Sucesso**

```json
{
  "assets": [
    { "symbol": "BTCUSDT", "name": "Bitcoin / USDT",   "category": "crypto", "payout": 95, "is_active": true },
    { "symbol": "ETHUSDT", "name": "Ethereum / USDT",  "category": "crypto", "payout": 95, "is_active": true },
    { "symbol": "BNBUSDT", "name": "BNB / USDT",       "category": "crypto", "payout": 95, "is_active": true }
  ]
}
```

**Observações**:

- O `symbol` aqui é o formato **compacto** (sem barra) — use-o **exatamente** como aparece no `POST /trade`.
- Hoje só assets Binance (cripto) estão listados via Bot API (ativos OTC podem aparecer no futuro).
- `payout` reflete o valor atual; admin pode ajustar e isso afeta novos trades.

**Erros**: `401 UNAUTHORIZED`, `403 ACCOUNT_BLOCKED`.

---

### 7.6 POST /bot/v1/trade

Abre uma operação na **conta REAL** do usuário.

**Auth**: ✅ Bearer access_token

**Body**

```json
{
  "symbol": "BTCUSDT",
  "direction": "up",
  "stake": 10,
  "duration_seconds": 60
}
```

| Campo              | Tipo                              | Regra                                                                  |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------- |
| `symbol`           | string                            | 2–20 chars. Aceita "BTCUSDT" (compacto) ou "BTC/USDT" (display).       |
| `direction`        | `"up"` \| `"down"`                | "up" = aposta que sobe; "down" = aposta que cai.                       |
| `stake`            | number                            | Positivo, múltiplo de 0.01. Deve estar entre `settings.operationMin` e `settings.operationMax`. |
| `duration_seconds` | `60` \| `300` \| `900`            | Apenas esses 3 valores.                                                |

**201 Sucesso**

```json
{
  "success": true,
  "trade": {
    "id": "ckl-trade-id",
    "symbol": "BTCUSDT",
    "direction": "up",
    "stake": 10,
    "entry_price": 67420.15,
    "payout_percentage": 95,
    "expires_at": "2026-05-27T18:25:30.000Z",
    "created_at": "2026-05-27T18:24:30.000Z"
  },
  "new_balance": 1490.50
}
```

- `id` é o que você usa para acompanhar via `GET /trade/:id`.
- `new_balance` já está com o stake debitado (a plataforma debita atomicamente na abertura).
- `expires_at` é o timestamp exato do servidor — use-o para saber quando consultar o resultado.

**Erros**

| HTTP | `error`                | Quando                                                                       |
| ---- | ---------------------- | ---------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`     | Body fora do schema (símbolo inválido, direção != up/down, duration != 60/300/900). |
| 400  | `STAKE_OUT_OF_RANGE`   | Stake fora dos limites. Resposta inclui `min` e `max`. Veja exemplo abaixo.  |
| 400  | `INSUFFICIENT_BALANCE` | Saldo REAL insuficiente para cobrir o stake.                                 |
| 404  | `ASSET_NOT_FOUND`      | Símbolo não existe no catálogo (ou está desativado).                         |
| 404  | `ACCOUNT_NOT_FOUND`    | Usuário não tem conta REAL (situação rara — todo registro cria DEMO + REAL). |
| 429  | `TOO_FAST`             | Trade anterior foi há menos de `operationMinIntervalMs` (default 1000ms).    |
| 401  | `UNAUTHORIZED`         | Token inválido / ausente.                                                    |
| 403  | `ACCOUNT_BLOCKED`      | Conta bloqueada.                                                             |

**Exemplo de `STAKE_OUT_OF_RANGE`**

```json
{
  "error": "STAKE_OUT_OF_RANGE",
  "min": 5,
  "max": 100000
}
```

**Exemplo cURL**

```bash
curl -X POST https://api.gwbroker.com.br/bot/v1/trade \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"up","stake":10,"duration_seconds":60}'
```

---

### 7.7 GET /bot/v1/trades

Histórico de operações, paginado.

**Auth**: ✅ Bearer access_token

**Query params**

| Param    | Tipo                                    | Default | Regra                                  |
| -------- | --------------------------------------- | ------- | -------------------------------------- |
| `status` | `"open"` \| `"closed"` \| `"all"`       | `"all"` | Filtra por estado.                     |
| `limit`  | number (1–200)                          | 50      | Máximo de trades retornados.           |
| `offset` | number (≥ 0)                            | 0       | Quantidade pra pular (paginação).      |

> Observação: o backend hoje busca via `listOperations(userId)` que retorna as 50 operações mais recentes. `limit` e `offset` atuam **sobre esse pool** — não há ainda paginação ilimitada via Bot API. Para histórico longo, consulte mais frequentemente ou use o dashboard web.

**200 Sucesso**

```json
{
  "trades": [
    {
      "id": "trade-id-1",
      "symbol": "BTCUSDT",
      "direction": "up",
      "stake": 10,
      "entry_price": 67420.15,
      "exit_price": 67510.50,
      "payout_percentage": 95,
      "result": "win",
      "profit": 9.50,
      "status": "closed",
      "created_at": "2026-05-27T18:24:30.000Z",
      "expires_at": "2026-05-27T18:25:30.000Z",
      "closed_at": "2026-05-27T18:25:30.123Z"
    }
  ],
  "count": 1,
  "limit": 50,
  "offset": 0
}
```

**Erros**: `401 UNAUTHORIZED`, `403 ACCOUNT_BLOCKED`, `400 VALIDATION_ERROR`.

---

### 7.8 GET /bot/v1/trade/:id

Detalhe de uma operação específica. Escopo: a operação deve pertencer ao usuário autenticado (404 se não for).

**Auth**: ✅ Bearer access_token

**Path params**

| Param | Tipo   | Regra                                       |
| ----- | ------ | ------------------------------------------- |
| `id`  | string | UUID retornado por `POST /trade` ou `GET /trades`. |

**200 Sucesso**

Retorna o **mesmo shape** do `Trade` em `/trades`:

```json
{
  "id": "trade-id-1",
  "symbol": "BTCUSDT",
  "direction": "up",
  "stake": 10,
  "entry_price": 67420.15,
  "exit_price": 67510.50,
  "payout_percentage": 95,
  "result": "win",
  "profit": 9.50,
  "status": "closed",
  "created_at": "2026-05-27T18:24:30.000Z",
  "expires_at": "2026-05-27T18:25:30.000Z",
  "closed_at": "2026-05-27T18:25:30.123Z"
}
```

**Padrão de polling para resultado**

Como a operação só resolve em `expires_at`, faça polling:

```js
async function waitForResolution(tradeId, expiresAt) {
  const wait = Math.max(0, new Date(expiresAt).getTime() - Date.now() + 1000)
  await new Promise(r => setTimeout(r, wait))
  // Pode levar até ~1s extra pra o worker resolver; tente até 5x com 500ms
  for (let i = 0; i < 5; i++) {
    const trade = await fetchTrade(tradeId)
    if (trade.status === 'closed') return trade
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Trade did not resolve in time')
}
```

**Erros**

| HTTP | `error`        | Quando                                              |
| ---- | -------------- | --------------------------------------------------- |
| 404  | `NOT_FOUND`    | ID não existe OU pertence a outro usuário.          |
| 401  | `UNAUTHORIZED` | Token inválido.                                     |
| 403  | `ACCOUNT_BLOCKED` | Conta bloqueada.                                 |

---

## Regras de negócio importantes

### Conta REAL apenas

Bot **sempre** opera na conta REAL. A conta DEMO não é acessível via Bot API (decisão de produto: bot deve trabalhar com dinheiro real ou não trabalhar).

### Min/Max stake

Os limites de stake são configurados pelo admin em `/admin/configuracoes` e ficam no objeto `PlatformSettings`:

- `operationMin` (default: **5**)
- `operationMax` (default: **100000**)

Estes são valores em BRL. Mudam dinamicamente — o bot deve estar preparado para receber `STAKE_OUT_OF_RANGE` mesmo depois de meses operando bem.

### Min interval entre trades

Configurável pelo admin (`operationMinIntervalMs`, default **1000ms**). Se você dispara duas trades em sequência rápido demais, a segunda volta com `429 TOO_FAST`.

### Rollover

Se o usuário tem saldo bônus (depósito com promo, etc.), o saque só libera depois que ele gira o valor `rollover_required` em apostas. Cada trade adiciona o `stake` ao `rollover_completed`. O bot vê isso em `GET /balance` mas **não precisa fazer nada especial** — apenas saiba que saque pode estar bloqueado.

### Conta bloqueada

Se o admin bloquear o usuário (`User.blocked = true`):
- Login continua funcionando (não há vazamento "essa conta existe e está bloqueada" vs "não existe"), mas devolve `403 ACCOUNT_BLOCKED` em vez do token.
- Tokens já emitidos param de funcionar imediatamente — toda chamada autenticada vira `403 ACCOUNT_BLOCKED`.

### 2FA é bypassado no bot

Decisão de produto: a Bot API ignora `User.twoFactorEnabled`. A web continua exigindo 2FA. Isso significa que um bot é tão seguro quanto a senha do usuário — incentive senhas fortes e rotação periódica do refresh_token.

### Resolução automática

Operações resolvem automaticamente em `expires_at`:
- Bot **não** precisa fechar trades manualmente.
- Não existe endpoint "fechar antecipado" via Bot API (a UI web tem "vender agora" mas não está exposta aqui).

---

## Fluxos completos

### Fluxo 1 — Operar e acompanhar resultado

```js
// 1) login
const login = await fetch(`${BASE}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then(r => r.json())

let accessToken  = login.access_token
let refreshToken = login.refresh_token

// 2) checar saldo
const balance = await fetch(`${BASE}/balance`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
console.log('Saldo:', balance.balance)

// 3) listar ativos
const { assets } = await fetch(`${BASE}/assets`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())

// 4) abrir uma operação
const tradeRes = await fetch(`${BASE}/trade`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    symbol: 'BTCUSDT',
    direction: 'up',
    stake: 10,
    duration_seconds: 60,
  }),
}).then(r => r.json())

const tradeId    = tradeRes.trade.id
const expiresAt  = tradeRes.trade.expires_at

// 5) esperar até expirar + 1s e buscar resultado
const waitMs = Math.max(0, new Date(expiresAt).getTime() - Date.now() + 1000)
await new Promise(r => setTimeout(r, waitMs))

const result = await fetch(`${BASE}/trade/${tradeId}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())

console.log('Resultado:', result.result, 'Lucro:', result.profit)
```

### Fluxo 2 — Refresh quando access_token expira

```js
async function authedFetch(path, init = {}) {
  let res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  })

  // Se o access expirou, tenta refresh e refaz a chamada
  if (res.status === 401) {
    const refreshRes = await fetch(`${BASE}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (refreshRes.status === 401) {
      throw new Error('Sessão expirou — refaça login')
    }
    const refreshed = await refreshRes.json()
    accessToken  = refreshed.access_token
    refreshToken = refreshed.refresh_token  // IMPORTANTE: rotacionado
    // Persistir refreshToken aqui

    // Tenta a chamada original de novo
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    })
  }
  return res
}
```

### Fluxo 3 — Lidar com `TOO_FAST` (sequência de trades)

```js
async function tradeWithBackoff(payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/trade`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (res.status === 429) {
      const body = await res.json()
      if (body.error === 'TOO_FAST') {
        await new Promise(r => setTimeout(r, 1100)) // espera o intervalo mínimo
        continue
      }
    }
    return await res.json()
  }
  throw new Error('Não conseguiu abrir trade depois de 3 tentativas')
}
```

---

## Códigos de erro — tabela completa

| `error`                  | HTTP | Onde acontece                          | O que fazer                                                  |
| ------------------------ | ---- | -------------------------------------- | ------------------------------------------------------------ |
| `VALIDATION_ERROR`       | 400  | Qualquer endpoint com body inválido    | Corrigir o payload. Veja `details` (Zod flatten) pra detalhe |
| `STAKE_OUT_OF_RANGE`     | 400  | `POST /trade`                          | Ajustar stake — resposta inclui `min` e `max` atuais         |
| `INSUFFICIENT_BALANCE`   | 400  | `POST /trade`                          | Depositar ou reduzir stake                                   |
| `SAME_PASSWORD`          | 400  | (não aplicável no bot)                 | —                                                            |
| `INVALID_CREDENTIALS`    | 401  | `POST /login`                          | Email/senha errados                                          |
| `UNAUTHORIZED`           | 401  | Qualquer endpoint autenticado          | Token inválido/expirado → tentar `/refresh` ou refazer login |
| `REFRESH_INVALID`        | 401  | `POST /refresh`                        | Refresh expirado/revogado → refazer login                    |
| `ACCOUNT_BLOCKED`        | 403  | Qualquer endpoint                      | Admin bloqueou a conta — contatar suporte                    |
| `USER_NOT_FOUND`         | 404  | `GET /profile`                         | Conta foi deletada — refazer login não vai resolver          |
| `ACCOUNT_NOT_FOUND`      | 404  | `POST /trade`                          | Inconsistência rara — contatar suporte                       |
| `ASSET_NOT_FOUND`        | 404  | `POST /trade`                          | Símbolo não existe → consultar `/assets`                     |
| `NOT_FOUND`              | 404  | `GET /trade/:id`                       | Trade não existe ou é de outro usuário                       |
| `RATE_LIMIT_EXCEEDED`    | 429  | `POST /login`                          | Esperar `retry_after` segundos                               |
| `TOO_FAST`               | 429  | `POST /trade`                          | Esperar `operationMinIntervalMs` antes da próxima            |
| `INTERNAL_ERROR`         | 500  | Qualquer endpoint                      | Erro do servidor — retry com backoff exponencial             |

---

## Notas para implementação de cliente

### Persistência de tokens

- **Não** salve em localStorage / cookie acessível por JS sem CSP forte. Use:
  - Backend de bot: variáveis de ambiente ou cofre (Vault, AWS Secrets Manager, Doppler).
  - Bot CLI local: arquivo encriptado em `~/.config/gwbroker-bot/tokens.enc`.
- Sempre **substitua** o refresh_token após cada chamada a `/refresh`.

### Concorrência

Múltiplas threads/workers do mesmo bot rodando contra a mesma conta:
- O `TOO_FAST` é por **usuário**, não por IP. Coordene seus workers para não disparar trades simultaneamente.
- `/refresh` invalida o token antigo — se 2 workers tentarem refresh ao mesmo tempo, um falha. Centralize a rotação em um único worker (líder eleito ou Redis lock).

### Drift de relógio

`expires_at` é wall-clock do servidor. Se o relógio do bot estiver atrasado/adiantado, agendamento de polling pode errar. Use `expires_at` em vez de calcular `Date.now() + duration_seconds * 1000`.

### Erros de rede

Toda chamada deve ter timeout (recomendo 10s para `POST /trade`, 5s pros demais) e retry com backoff exponencial para erros 5xx (não 4xx — esses são você).

### Cabeçalho User-Agent

Mande um User-Agent identificável (ex: `GW-Bot/MyTrader 1.0`). Facilita o time da plataforma diagnosticar problemas em logs.

### Logs sensíveis

**Nunca logue** o `access_token` ou `refresh_token` em texto puro. Use hash dos primeiros 8 chars se precisar correlacionar requests em log.

### Versionamento

O path `/v1` é estável. Mudanças backwards-incompatible (rename de campo, mudança de tipo, deleção de endpoint) entram em `/v2`. Mudanças aditivas (novo campo opcional, novo endpoint) podem entrar em `/v1` sem aviso.

---

## Apêndice — relacionamento com endpoints internos

Para quem está trabalhando dentro do monorepo:

| Bot endpoint                | Service interno chamado                           | Arquivo                                  |
| --------------------------- | ------------------------------------------------- | ---------------------------------------- |
| `POST /bot/v1/login`        | `prisma.user.findUnique` + `bcrypt.compare`       | `apps/api/src/bot/routes.ts`             |
| `POST /bot/v1/refresh`      | `rotateRefreshToken`                              | `apps/api/src/bot/tokens.ts`             |
| `GET  /bot/v1/profile`      | `prisma.user.findUnique({ include: { accounts }})`| `apps/api/src/bot/routes.ts`             |
| `GET  /bot/v1/balance`      | `prisma.account.findMany`                         | `apps/api/src/bot/routes.ts`             |
| `GET  /bot/v1/assets`       | `listBinanceAssets`                               | `apps/api/src/market/service.ts`         |
| `POST /bot/v1/trade`        | `createOperation`                                 | `apps/api/src/operations/service.ts`     |
| `GET  /bot/v1/trades`       | `listOperations`                                  | `apps/api/src/operations/service.ts`     |
| `GET  /bot/v1/trade/:id`    | `getOperation`                                    | `apps/api/src/operations/service.ts`     |

Os mappers `mapAsset`, `mapTrade`, `mapBalance`, `mapProfile` ficam em `apps/api/src/bot/mappers.ts` e isolam o shape camelCase do banco do shape snake_case da API pública.

---

**Última atualização**: 2026-05-27
**Versão da API**: v1
**Mantenedor**: GW Broker Engineering
