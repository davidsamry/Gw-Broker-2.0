# Meta Conversions API — Integração completa

Integração server-side com a Meta Conversions API (Pixel + CAPI) para
rastrear cadastros e depósitos. **Toda configuração via painel admin
(`/admin/meta-pixel`) — não usa variáveis de ambiente.**

## Eventos enviados

Apenas dois:

| Evento | Quando dispara | event_id |
| --- | --- | --- |
| `CompleteRegistration` | Após criar usuário no DB | `registration_{userId}_{epoch}` |
| `Purchase` | Após depósito confirmar (PENDING → PAID) | `purchase_{depositId}_{userId}` |

Nenhum outro evento é gerado pelo backend. Login, KYC, saque, operações,
trades, etc. **não disparam Meta**.

## Como acessar `/admin/meta-pixel`

1. Painel admin → menu lateral → **Meta Pixel**
2. Apenas usuários com `role = ADMIN` veem o link e podem chamar os endpoints
3. URL direta: `https://vx-global.com/admin/meta-pixel`

## Como configurar Pixel ID

1. No Gerenciador de Eventos da Meta (https://business.facebook.com/events_manager2),
   copie o **ID do Pixel** (formato numérico, ex: `1660498221521632`)
2. Cole no campo **Meta Pixel ID** da página
3. Clique **Salvar Configurações**

Validação:
- Apenas dígitos aceitos (UI filtra na hora de digitar)
- Backend rejeita com 400 `PIXEL_ID_REQUIRED` se ativar integração sem ID

## Como configurar Token

1. Na mesma tela do Gerenciador, em **Configurações da Conversions API**,
   gere um **Access Token** (System User Token recomendado para produção)
2. Cole no campo **Meta Pixel Token** (input password, com toggle 👁 pra mostrar)
3. Clique **Salvar Configurações**

O token é armazenado no banco (`meta_pixel_settings.pixelToken`). **Nunca**
volta pro frontend em plaintext — o GET retorna apenas:

```json
{
  "enabled": true,
  "pixelId": "1660498221521632",
  "hasToken": true,
  "tokenPreview": "EAA...abcd",
  "testEventCode": "TEST123"
}
```

Para **trocar** o token, basta colar o novo. Para **manter o atual** ao
editar outros campos, deixe o input vazio (a UI mostra um placeholder
`(token salvo: EAA...abcd — deixe vazio para manter)`).

## Como usar código de teste

1. No Gerenciador → aba **Test Events** → copie o código (ex: `TEST12345`)
2. Cole no campo **Código de Teste da Meta** da página
3. Salve

Eventos disparados vão pra aba "Test Events" no Gerenciador da Meta em
tempo real, **não contam** nas estatísticas de produção.

**Limpe o campo** (e salve) para começar a enviar em produção.

## Como funciona CompleteRegistration

Disparado em `apps/api/src/auth/service.ts` → `registerUser()`, logo
após o `user.create()` e o welcome email. Fluxo:

1. Frontend coleta `fbp` (cookie), `fbc` (cookie ou sintetizado de
   `fbclid`), `utm_*` (query string)
2. POST `/auth/register` inclui `tracking: {...}` no body
3. Backend salva em `user_tracking` (UPSERT por userId)
4. Backend chama `sendCompleteRegistrationAsync({ id, email })`
5. Sender lê `meta_pixel_settings` → POST `https://graph.facebook.com/v23.0/{pixelId}/events`
6. Resposta + payload gravados em `meta_events_log`

Payload exato:
```json
{
  "data": [{
    "event_name":    "CompleteRegistration",
    "event_time":    1748452800,
    "event_id":      "registration_cmpp8pimh0008_1748452800",
    "action_source": "website",
    "user_data": {
      "em":          ["<sha256(lowercase(email))>"],
      "external_id": ["<sha256(userId)>"],
      "fbp":         "fb.1.1748400000.1234567890",
      "fbc":         "fb.1.1748400000.AbCdEf",
      "client_ip_address": "1.2.3.4",
      "client_user_agent": "Mozilla/5.0..."
    }
  }],
  "test_event_code": "TEST123"   // só presente se configurado
}
```

## Como funciona Purchase

Disparado em `apps/api/src/deposits/service.ts` → `confirmDepositById()`,
após a transição `PENDING → PAID` ser atomicamente confirmada. **Nunca**
dispara em PENDING/PROCESSING/REJECTED/CANCELLED.

Payload:
```json
{
  "data": [{
    "event_name":    "Purchase",
    "event_time":    1748452800,
    "event_id":      "purchase_dep_xyz_user_abc",
    "action_source": "website",
    "user_data":     { ...mesmo do CompleteRegistration },
    "custom_data": {
      "currency":         "USD",
      "value":            150.00,
      "content_name":     "Deposit",
      "content_category": "Broker Deposit",
      "deposit_id":       "dep_xyz"
    }
  }]
}
```

## Como validar no Gerenciador de Eventos da Meta

1. Preencha o campo **Código de Teste da Meta** com o código do Gerenciador
2. Salve a configuração
3. Faça 1 cadastro e 1 depósito de teste
4. Vá no Gerenciador → seu Pixel → aba **Test Events**
5. Deve aparecer:
   - `CompleteRegistration` com `event_id=registration_...`
   - `Purchase` com `event_id=purchase_...` e `value=...`
6. Se aparecer: tudo OK. Limpe o test code e salve para enviar em produção.

## Como verificar logs

### Console da API (EasyPanel)
```
[meta] CompleteRegistration event_id=registration_... pixel=166... token=EAA...abcd success=true
[meta] Purchase event_id=purchase_... pixel=166... token=EAA...abcd success=true
[meta] dedup skip event_id=... (already sent)
```

### Tabela `meta_events_log` (auditoria persistente)
```sql
SELECT "eventName", "eventId", success, "errorMessage", "createdAt"
FROM meta_events_log
ORDER BY "createdAt" DESC
LIMIT 50;
```

Cada disparo (sucesso ou falha) gera 1 linha. O payload completo + a
resposta da Meta ficam na coluna `payload` / `response` (JSONB).

## Como evitar eventos duplicados

Garantido em três camadas:

1. **`event_id` determinístico**:
   - Registration: `registration_{userId}_{epoch}` — o epoch garante
     unicidade entre tentativas em diferentes ticks (caso o flow retry
     manual ocorra)
   - Purchase: `purchase_{depositId}_{userId}` — fixo por depósito
2. **Dedupe via `meta_events_log`**: antes de cada POST, query
   `SELECT 1 WHERE eventId=$1 AND success=TRUE LIMIT 1`. Se já enviou,
   pula com log `dedup skip`.
3. **Gate no fluxo de negócio**: `confirmDepositById` só roda 1x por
   PENDING→PAID (CTE atômico). Re-confirm em depósito já PAID retorna
   `false` sem chamar Meta.

## Segurança

- Token armazenado apenas no banco (coluna `pixelToken`)
- GET admin retorna apenas `tokenPreview` mascarado + `hasToken` boolean
- POST exige role ADMIN (middleware `requireAdmin`)
- Token nunca aparece completo em logs (`maskToken()` helper aplicado)
- Token nunca chega ao frontend público nem ao bundle do navegador
- Helper de hash aplica SHA-256 lowercase em email/telefone/userId
  (Meta spec)
- Frontend só envia atribuição não-sensível: `fbp/fbc/utm_*/fbclid`

## Falhas — sistema continua funcionando

Se a Meta retornar erro ou estiver fora:
- **Cadastro**: completa normalmente. Linha em `meta_events_log` com
  `success=false` + `errorMessage`.
- **Depósito**: credita saldo normalmente. Mesma linha de falha em
  `meta_events_log`.
- **Sistema financeiro**: 100% intacto. Nenhum throw escapa do sender.

Não há retry automático no sender da Meta — se falhar, fica logado e
o admin pode reenviar manualmente via SQL ou um endpoint admin futuro.
Diferente do `webhooks/service.ts` (TrackFlow), aqui o Meta normalmente
aceita e a falha é raríssima.

## Arquivos relevantes

```
apps/api/prisma/migrations/20260528240000_meta_pixel/migration.sql
apps/api/prisma/schema.prisma                  (3 models novos)
apps/api/src/meta/settings.ts                  (config CRUD + maskToken)
apps/api/src/meta/tracking.ts                  (UPSERT user_tracking)
apps/api/src/meta/service.ts                   (sendMetaEvent core)
apps/api/src/admin/meta/routes.ts              (GET + PATCH /admin/meta-pixel)
apps/api/src/admin/routes.ts                   (mount admin sub-prefix)
apps/api/src/auth/schema.ts                    (+ tracking field optional)
apps/api/src/auth/service.ts                   (+ trigger CompleteRegistration)
apps/api/src/auth/routes.ts                    (+ ip/userAgent forward)
apps/api/src/deposits/service.ts               (+ trigger Purchase)

apps/web/src/lib/metaTracking.ts               (captura fbp/fbc/utm client)
apps/web/src/store/auth.ts                     (register envia tracking)
apps/web/src/app/admin/meta-pixel/page.tsx     (página admin)
apps/web/src/components/admin/AdminSidebar.tsx (link "Meta Pixel")
```
