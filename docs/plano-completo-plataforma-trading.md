 PLANO COMPLETO - PLATAFORMA DE NEGOCIAÇÃO DE OPÇÕES BINÁRIAS/DIGITAIS
## Versão 1.0 | Escopo: 100 usuários simultâneos | VPS DigitalOcean único

---

## PARTE 1 - DEFINIÇÃO DO ESCOPO INICIAL

### 1.1. Visão do Produto
Construir uma corretora digital de opções binárias/digitais voltada para o mercado brasileiro, operando com dinheiro real via PIX (BSPAY), conta demo para prática, e infraestrutura enxuta em um único VPS DigitalOcean. A plataforma deve entregar uma experiência de trading fluida, com gráficos em tempo real, execução rápida de ordens e transparência total em auditoria.

### 1.2. Caminho de Negócio
- **Modelo:** Corretora real (B-book com hedge parcial inicialmente desabilitado por simplicidade e volume baixo).
- **Pagamentos:** PIX via BSPAY (gateway já integrado).
- **Saques:** Processamento manual com fila de aprovação administrativa.
- **KYC:** Verificação manual de documentos (RG/CNH, comprovante residência, selfie) via upload no painel do usuário e análise no painel admin.
- **Auditoria:** Todo movimento financeiro e operacional gera hash de auditoria imutável.

### 1.3. Restrições de Volume (100 usuários)
- **Usuários simultâneos máximos:** 100 conexões WebSocket ativas.
- **Operações por segundo (pico):** Estimado em 10-20 ops/segundo (cenário extremo).
- **Banco de dados:** PostgreSQL único no mesmo servidor, sem replicação.
- **Cache:** Redis único no mesmo servidor, sem cluster.
- **Motivo:** Com 100 usuários, a complexidade de orquestração (Kubernetes, load balancers, múltiplos droplets) é desnecessária e custosa. O foco é estabilidade e baixo custo operacional.

### 1.4. Funcionalidades do MVP
1. Cadastro/login com e-mail e senha (JWT).
2. Carteira dual: Demo (saldo virtual fixo recarregável) e Real (saldo via PIX).
3. Trading de opções binárias em ativos forex (EUR/USD, USD/JPY, GBP/USD, USD/BRL OTC).
4. Gráfico candlestick em tempo real com dados da Twelve Data.
5. Painel de operação com seleção de tempo (1 a 5 minutos), valor de investimento, botões CALL/PUT.
6. Histórico de operações abertas e fechadas em tempo real via WebSocket.
7. Depósito via PIX (BSPAY) com atualização automática de saldo.
8. Solicitação de saque com fila de aprovação manual.
9. Painel administrativo com controle de usuários, operações, saques, ativos e payouts.
10. Notificações via Telegram/WhatsApp (Evolution API) para eventos críticos (saque solicitado, depósito confirmado, operação ganha/perdida).

---

## PARTE 2 - ANÁLISE CRÍTICA DAS FERRAMENTAS ATUAIS

### 2.1. DigitalOcean VPS (1 Droplet 4GB RAM / 2 vCPU)
**Veredito: MANTER com upgrade planejado.**
- **Avaliação:** Para 100 usuários simultâneos, um droplet básico de 4GB/2vCPU é o mínimo aceitável. O NestJS + Next.js + PostgreSQL + Redis + n8n no mesmo servidor exigirá tuning cuidadoso.
- **Quando escalar:** Se o uso de CPU sustentado passar de 70% ou RAM de 80% por mais de 5 minutos em horários de pico.
- **Escalabilidade futura:** Separar em 2 droplets (um para aplicação, outro para banco de dados/cache) quando ultrapassar 200 usuários ativos.
- **Ação imediata:** Monitorar com `htop`, `docker stats`, e configurar alertas DO.

### 2.2. EasyPanel
**Veredito: MANTER com hardening severo.**
- **Avaliação:** Facilita gerenciamento de containers, bancos e backups. Para 100 usuários, é uma ferramenta válida para reduzir complexidade operacional.
- **Riscos:** Painel exposto à internet é alvo constante de brute force e exploits.
- **Ações:**
  - Alterar porta padrão do EasyPanel.
  - Ativar 2FA obrigatório para todos os usuários do painel.
  - Restringir acesso ao painel por IP fixo (whitelist do IP do administrador).
  - Senha de 20+ caracteres, gerenciada por password manager.
  - Desabilitar registro de novos usuários no EasyPanel.

### 2.3. Docker (DESATUALIZADO - RISCO CRÍTICO)
**Veredito: ATUALIZAR IMEDIATAMENTE.**
- **Avaliação:** Docker desatualizado contém vulnerabilidades conhecidas de escape de container e privilégios. Isso é inaceitável em uma plataforma financeira.
- **Ações imediatas:**
  - Executar `apt update && apt upgrade docker-ce docker-ce-cli containerd.io`.
  - Verificar versão: `docker --version` (deve ser 25.x+ ou a mais recente estável).
  - Ativar Docker Content Trust (`export DOCKER_CONTENT_TRUST=1`).
  - Usar apenas imagens oficiais e verificadas (Docker Hub Official Images).
  - Configurar Docker daemon com `userns-remap` para isolar privilégios de root.
  - Limitar recursos por container (`--memory`, `--cpus`).

### 2.4. GitHub
**Veredito: MANTER e fortalecer proteções.**
- **Avaliação:** Controle de versão essencial. Necessário reforçar branch protection e secrets management.
- **Ações:**
  - Repositório privado obrigatório.
  - Branch `main` protegida: exigir PR para merge, exigir aprovação de 1 reviewer, exigir checks de CI.
  - Habilitar GitHub Advanced Security (dependabot alerts, secret scanning).
  - Nunca commitar `.env`, chaves API, senhas. Usar GitHub Secrets para CI/CD.
  - `.gitignore` rigoroso para arquivos sensíveis.

### 2.5. PostgreSQL
**Veredito: MANTER com tuning e backups.**
- **Avaliação:** Banco relacional robusto. Para 100 usuários, performance não será gargalo se indexado corretamente.
- **Responsabilidades:** Usuários, carteiras, operações, histórico de preços (candles), transações financeiras (depósitos/saques), logs de auditoria.
- **Ações:**
  - Versão 15+.
  - Habilitar `pg_stat_statements` para query tuning.
  - Configurar backups automáticos diários via EasyPanel ou `pg_dump` cron job.
  - Criptografia em repouso (LUKS ou criptografia de volume DO).
  - Usuário PostgreSQL dedicado para aplicação (nunca usar `postgres` superuser).

### 2.6. Redis
**Veredito: MANTER com configurações de segurança e persistência.**
- **Avaliação:** Essencial para cache, sessões, rate limit, pub/sub de WebSocket, filas BullMQ e expiração de trades.
- **Ações:**
  - Ativar senha forte no Redis (`requirepass`).
  - Desabilitar comandos perigosos: `FLUSHALL`, `FLUSHDB`, `CONFIG`, `DEBUG` via `rename-command`.
  - Habilitar AOF persistência (`appendonly yes`) para evitar perda de dados de filas.
  - Isolar Redis em Docker network interna (não expor porta 6379 publicamente).

### 2.7. n8n
**Veredito: MANTER apenas para automações não-financeiras.**
- **Avaliação:** Útil para notificações, alertas, relatórios automáticos e integrações.
- **RESTRIÇÃO CRÍTICA:** NUNCA usar n8n para processar depósitos, saques, cálculo de trades, ou qualquer lógica financeira. n8n é assíncrono e não transacional. Falhas de execução podem causar perda de consistência financeira.
- **Uso permitido:**
  - Notificar admin no Telegram quando saque for solicitado.
  - Enviar e-mail de boas-vindas.
  - Gerar relatório diário de novos usuários.

### 2.8. Evolution API
**Veredito: MANTER para notificações push.**
- **Avaliação:** Gateway para WhatsApp/Telegram. Útil para alertas de conta e marketing.
- **Uso:** Notificações de depósito confirmado, saque aprovado, alertas de segurança (login de novo IP).

### 2.9. Twelve Data
**Veredito: MANTER com cache agressivo e monitoramento de créditos.**
- **Avaliação:** Fonte de dados de mercado. Plano com limitação de créditos exige otimização.
- **Estratégia:**
  - Apenas o backend consome a API. A API Key fica no servidor, NUNCA no frontend.
  - Uma única conexão/polling no backend distribui dados para todos os usuários via WebSocket próprio.
  - Cache Redis: preços a cada 5 segundos, candles a cada 1 minuto.
  - Implementar fallback para preços simulados (random walk baseado no último preço real) se os créditos acabarem, com flag visual no frontend indicando "MODO SIMULAÇÃO".
  - Logging detalhado de falhas e uso de créditos.

### 2.10. BSPAY
**Veredito: MANTER (já integrado, gateway ativo).**
- **Avaliação:** Gateway PIX já funcional. Necessário apenas mapear webhooks corretamente.
- **Ações:**
  - Validar assinatura/segredo do webhook para evitar spoofing.
  - Idempotência no processamento de webhooks (processar mesmo UUID de pagamento apenas uma vez).
  - Log de todos os callbacks recebidos.

---

## PARTE 3 - ARQUITETURA SIMPLIFICADA (1 VPS, 100 usuários)

### 3.1. Diagrama Conceitual

```
┌──────────────────────────────────────────────────────────────┐
│                    DIGITALOCEAN VPS (4GB/2vCPU)              │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Cloudflare │  │   Nginx      │  │   EasyPanel      │   │
│  │   (DNS/SSL)  │──│   (Reverse   │──│   (Gerenciamento)│   │
│  │              │  │   Proxy)     │  │                  │   │
│  └──────────────┘  └──────┬───────┘  └──────────────────┘   │
│                           │                                  │
│  ┌────────────────────────┼──────────────────────────────┐   │
│  │           DOCKER NETWORK INTERNA                       │   │
│  │                                                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐   │   │
│  │  │  Next.js     │  │  NestJS API  │  │  WS Server │   │   │
│  │  │  (Frontend)  │  │  (REST API)  │  │  (Socket.io│   │   │
│  │  │  Porta 3000  │  │  Porta 3001  │  │  Porta 3002│   │   │
│  │  └──────────────┘  └──────┬───────┘  └─────┬──────┘   │   │
│  │                           │                │          │   │
│  │  ┌──────────────┐  ┌──────┴───────┐  ┌────┴────────┐  │   │
│  │  │  PostgreSQL  │  │     Redis    │  │   n8n       │  │   │
│  │  │  Porta 5432  │  │   Porta 6379 │  │   Porta 5678│  │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │   │
│  │                                                        │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 3.2. Componentes

#### 3.2.1. Frontend Web (Next.js)
- SSR/SSG para SEO e performance inicial.
- SPA experience após hidratação para trading em tempo real.
- Comunicação com backend via REST API e WebSocket.

#### 3.2.2. Backend API (NestJS)
- Arquitetura modular (Auth, Users, Wallet, Trading, MarketData, Admin, Webhooks).
- REST API para operações síncronas (login, criar operação, solicitar saque).
- Integração direta com PostgreSQL via Prisma.
- Enfileiramento de jobs no Redis via BullMQ.

#### 3.2.3. WebSocket Server (Socket.io ou WS nativo do NestJS)
- Canal único de broadcast de preços de mercado para todos os clientes conectados.
- Canal privado por usuário para atualizações de saldo, resultado de operações e notificações.
- Heartbeat e reconexão automática no frontend.

#### 3.2.4. Motor de Operações (BullMQ Workers no NestJS)
- Worker dedicado que consome jobs de expiração de trades.
- Ao expirar, consulta preço de fechamento, calcula resultado, atualiza saldo, emite WS.
- Idempotência garantida via estado do job e hash de auditoria.

#### 3.2.5. Serviço de Dados de Mercado (Módulo NestJS)
- Scheduler que consome Twelve Data a cada 5s (ticks) e 1min (candles).
- Armazena no Redis e broadcast via WS.
- Fallback para simulação em caso de falha/limitação.

#### 3.2.6. Painel Admin (Next.js ou módulo do frontend com rota protegida `/admin`)
- Interface separada ou rota isolada com middleware de permissão.
- Dashboard com estatísticas, tabelas de usuários, operações, saques.

### 3.3. Fluxo Completo de Operação

1. **Usuário acessa plataforma:** Nginx serve Next.js. Frontend se conecta ao WS Server.
2. **Dados de mercado:** Serviço Twelve Data -> Redis -> WS Server -> Frontend (broadcast).
3. **Usuário abre operação:**
   - Frontend envia POST `/trades` para NestJS API.
   - API valida JWT, saldo, ativo ativo.
   - API cria registro `PENDING` no PostgreSQL.
   - API debita saldo (congelamento) e atualiza carteira.
   - API agenda job BullMQ para o horário de expiração exato.
   - API retorna tradeId e emite evento WS para frontend.
4. **Expiração:**
   - BullMQ Worker executa no horário exato.
   - Worker consulta preço de fechamento (Twelve Data ou cache Redis).
   - Worker calcula WIN/LOSS/DRAW comparando preço entrada e fechamento.
   - Worker atualiza registro para `CLOSED` com resultado.
   - Worker credita saldo (se WIN) na carteira.
   - Worker gera hash SHA-256 de auditoria do movimento.
   - Worker emite evento WS para o usuário com resultado.
5. **Depósito:**
   - Usuário solicita PIX via API -> BSPAY cria cobrança -> retorna QR Code.
   - BSPAY envia webhook para `/webhooks/bspay`.
   - API valida webhook, identifica usuário, credita saldo real.
   - API emite WS e notificação (n8n/Evolution API).
6. **Saque:**
   - Usuário solicita saque via API -> cria registro `PENDING` no PostgreSQL.
   - n8n notifica admin no Telegram.
   - Admin analisa no painel admin, aprova ou rejeita.
   - Se aprovado, admin executa transferência manualmente (ou via API BSPAY se disponível) e marca como `COMPLETED`.

---

## PARTE 4 - STACK RECOMENDADA (Nível Único, Simplificado)

### 4.1. Frontend
- **Framework:** Next.js 14+ (App Router) com TypeScript.
- **Estilização:** Tailwind CSS.
- **Componentes UI:** shadcn/ui (base sólida, customizável, sem lock-in de design system pesado).
- **Gerenciamento de Estado:** Zustand (simples, performático, sem boilerplate do Redux).
- **Gráficos:** Lightweight Charts™ (TradingView) - leve, gratuito, ideal para candlesticks e performance.
- **HTTP Client:** Axios com interceptors para JWT refresh.
- **WebSocket Client:** Socket.io-client.
- **Validação de Formulários:** React Hook Form + Zod.

### 4.2. Backend
- **Framework:** NestJS 10+ com TypeScript.
- **ORM:** Prisma (type-safe, migrações robustas, excelente DX).
- **Fila/Jobs:** BullMQ (baseado em Redis, com suporte a delayed jobs essencial para expiração de trades).
- **WebSocket:** `@nestjs/platform-socket.io` para gateway WS.
- **Scheduler:** `@nestjs/schedule` para polling de dados de mercado.
- **Validação:** Zod (mesma biblioteca do frontend para consistência de schemas) ou class-validator.
- **Documentação API:** Swagger (@nestjs/swagger) exposta apenas em ambiente de dev/staging.

### 4.3. Banco de Dados
- **Relacional:** PostgreSQL 15+.
- **Cache/Sessões/Filas:** Redis 7+.
- **Migrations:** Prisma Migrate.
- **Seeding:** Prisma Seed para dados iniciais (ativos, configs de payout).

### 4.4. Infraestrutura
- **Containerização:** Docker + Docker Compose.
- **Orquestração Local:** EasyPanel (para 100 usuários, não justifica Kubernetes).
- **Versionamento:** GitHub (repositório privado).
- **CDN/WAF/DNS:** Cloudflare (cache estático, proteção DDoS básica, SSL).
- **Proxy Reverso:** Nginx (dentro do Docker ou no host, servindo SSL via Let's Encrypt).

### 4.5. Segurança
- **Autenticação:** JWT (access token curto 15min, refresh token longo 7 dias em cookie httpOnly).
- **Hash de Senhas:** bcrypt (rounds 12+).
- **Headers HTTP:** Helmet.js.
- **CORS:** Configurado estritamente para o domínio da aplicação.
- **Rate Limit:** `rate-limiter-flexible` com store Redis (bloqueio por IP e por usuário).
- **Sanitização:** Zod para validação estrita de todos os inputs.
- **Logs:** Winston (backend) logando em arquivo + stdout. Logs de auditoria em tabela separada no PostgreSQL.

---

## PARTE 5 - DESIGN DA PLATAFORMA (Inspirado na Quotex, Identidade Própria)

### 5.1. Diretrizes de Identidade Visual
- **Inspiração:** Estrutura de 3 colunas da Quotex (sidebar + gráfico + painel de operação), fluxo de operação intuitivo.
- **Proibição:** Não copiar logo, nome, textos exatos, ícones proprietários, cores exatas de marca, tipografia idêntica, ou qualquer asset protegido por copyright da Quotex.
- **Nome da plataforma:** A definir pelo cliente (ex: "TradeFlow", "BinaryPro", etc.).

### 5.2. Paleta de Cores (Dark Mode Único - MVP)
- **Background principal:** `#0f1115` (mais profundo que o da referência para identidade própria).
- **Background secundário/painéis:** `#1a1d29`.
- **Background de cards/inputs:** `#232633`.
- **Candle de alta (CALL):** `#00c853`.
- **Candle de baixa (PUT):** `#ff1744`.
- **Botão CALL (verde):** `#00c853` com hover `#00e676`.
- **Botão PUT (vermelho):** `#ff1744` com hover `#ff4569`.
- **Texto principal:** `#ffffff`.
- **Texto secundário:** `#8b8f9a`.
- **Bordas/divisórias:** `#2a2e3b`.
- **Accent/Destaque:** `#3b82f6` (azul para elementos de destaque próprios, diferenciando da marca de referência).

### 5.3. Layout da Tela Principal (3 Colunas)

#### 5.3.1. Header (Topo)
- **Esquerda:** Logo da plataforma (proprietário).
- **Centro:** Toggle CONTA REAL / CONTA DEMO (switch estilizado, real em dourado/azul, demo em cinza).
- **Direita:**
  - Ícone de notificações (sino com badge vermelho).
  - Saldo atual (formatação de moeda BRL).
  - Botão "Depositar" (verde, destaque).
  - Botão "Retirar" (outline cinza).
  - Avatar do usuário (dropdown: Perfil, Histórico, Sair).

#### 5.3.2. Coluna Esquerda (Sidebar Vertical)
Largura fixa (~64px expandido ou ~200px colapsado). Ícones + texto.
- **TRADE** (ativo por padrão): Gráfico e operação.
- **SORTE**: Jogo/roleta simples (se aplicável ao modelo de negócio).
- **CONTA**: Perfil, documentos KYC, configurações.
- **TORNEIOS**: Competições entre traders (futuro, desabilitar no MVP se não for prioridade).
- **MERCADO**: Listagem completa de ativos e seus payouts.
- **MAIS** (submenu): Análise, Ranking TOP, Sinais (futuro).
- **AJUDA**: FAQ, chat com suporte, tutoriais.

#### 5.3.3. Coluna Central (Área do Gráfico)
- **Tabs de Ativos:** Rolagem horizontal com bandeirinhas dos países + par (ex: 🇪🇺🇺🇸 EUR/USD) + payout% em badge colorido.
- **Gráfico Candlestick:** Ocupa 70% da altura. TradingView Lightweight Charts.
  - Linhas de abertura e fechamento da operação atual (quando houver).
  - Contador regressivo visual sobre o candle atual (se houver trade aberto).
  - Toolbar flutuante: zoom in/out, reset, tipos de gráfico (candle, line, area), ferramentas de desenho (tendência, horizontal - futuro).
- **Barra de Tempo:** Seletor de timeframe do gráfico (1M, 5M, 15M, 1H).

#### 5.3.4. Coluna Direita (Painel de Operação)
- **Ativo Atual:** Nome grande + payout% em destaque.
- **Seletor de Tempo de Expiração:** Botões segmentados (00:01:00, 00:02:00, 00:05:00) ou input customizado.
- **Seletor de Investimento:** Input numérico com botões de +/- (R$ 10, R$ 25, R$ 50, R$ 100, R$ 500). Validar saldo mínimo/máximo.
- **Pagamento Estimado:** Cálculo ao vivo `(investimento * payout%) + investimento`.
- **Botões de Ação:**
  - **PARA CIMA (CALL):** Botão verde grande, ícone de seta para cima. Texto "Comprar" ou "Alto".
  - **PARA BAIXO (PUT):** Botão vermelho grande, ícone de seta para baixo. Texto "Vender" ou "Baixo".
- **Lista de Operações Abertas:** Cards compactos mostrando ativo, valor, direção, tempo restante (contador regressivo), preço de entrada.
- **Histórico Recente:** Últimas 5-10 operações fechadas com cor win/loss e valor.

### 5.4. Painel Administrativo
- **Layout:** Sidebar escura (diferente da do usuário, mais compacta) + área de conteúdo.
- **Cores:** Manter dark mode, mas com accent azul ou roxo para diferenciar ambiente admin.
- **Dashboard:** Cards com KPIs (usuários ativos hoje, volume de trades, saldo total em custódia, saques pendentes).
- **Tabelas:** Data tables com paginação, filtros, ordenação. shadcn/ui Table + TanStack Table.
- **Modais:** Para ações rápidas (aprovar saque, editar payout, banir usuário).

---

## PARTE 6 - MOTOR DE OPERAÇÕES (O NÚCLEO DA PLATAFORMA)

### 6.1. Requisitos Críticos
- **Backend é a única fonte da verdade.** O frontend apenas solicita, nunca calcula resultado.
- **Imutabilidade:** Uma vez criada, a operação só muda de `PENDING` -> `CLOSED`. Nunca editada.
- **Precisão temporal:** Usar timestamps UTC no banco, converter para local no frontend.
- **Resiliência:** Falhas no worker não podem perder operações. BullMQ com retries e dead letter queue.

### 6.2. Estrutura de Dados (Prisma Schema - Trecho)
```prisma
enum TradeDirection {
  CALL
  PUT
}

enum TradeStatus {
  PENDING
  CLOSED
  CANCELLED
}

enum TradeResult {
  WIN
  LOSS
  DRAW
}

model Trade {
  id              String        @id @default(cuid())
  userId          String
  assetId         String
  direction       TradeDirection
  amount          Decimal       @db.Decimal(18, 8)
  payoutRate      Decimal       @db.Decimal(5, 2) // ex: 0.85 para 85%
  entryPrice      Decimal       @db.Decimal(18, 8)
  exitPrice       Decimal?      @db.Decimal(18, 8)
  startTime       DateTime      @db.Timestamptz()
  expirationTime  DateTime      @db.Timestamptz()
  status          TradeStatus   @default(PENDING)
  result          TradeResult?
  profit          Decimal?      @db.Decimal(18, 8)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  
  user            User          @relation(fields: [userId], references: [id])
  asset           Asset         @relation(fields: [assetId], references: [id])
  auditLogs       AuditLog[]
  
  @@index([userId, status])
  @@index([expirationTime, status])
}
```

### 6.3. Fluxo Detalhado do Motor

#### 6.3.1. Criação da Operação (Endpoint POST /trades)
1. **Autenticação:** Validar JWT.
2. **Validação de Input (Zod):**
   - `assetId` existe e está ativo.
   - `direction` é CALL ou PUT.
   - `amount` dentro dos limites (ex: mín R$ 10, máx R$ 10.000).
   - `duration` permitido (60s, 120s, 300s).
3. **Validação de Saldo:**
   - Verificar `wallet.balance` da conta selecionada (demo ou real).
   - Garantir `balance >= amount`.
   - Iniciar transação no PostgreSQL.
4. **Congelamento de Saldo:**
   - `wallet.balance -= amount`.
   - `wallet.blockedBalance += amount`.
   - Registrar `BalanceChange` (tipo: BLOCKED_FOR_TRADE).
5. **Registro da Operação:**
   - `entryPrice` = preço atual do ativo (do cache Redis, timestamp do último tick).
   - `startTime` = now().
   - `expirationTime` = now() + duration.
   - `payoutRate` = buscar na configuração ativa do ativo.
   - Status = `PENDING`.
6. **Agendamento:**
   - Adicionar job à fila `trade-expiration` do BullMQ com `delay = expirationTime - now()`.
   - Job ID = `trade:{tradeId}`.
7. **Commit da transação.**
8. **Emissão de eventos:**
   - WS: `trade:opened` para o socket do usuário.
   - WS: `wallet:updated` com novo saldo.
9. **Retorno HTTP:** Trade object completo.

#### 6.3.2. Processamento de Expiração (BullMQ Worker)
1. **Worker `trade-expiration` consome job.**
2. **Idempotência:** Buscar trade no banco. Se status != `PENDING`, descartar (evita reprocessamento).
3. **Obter Preço de Fechamento:**
   - Consultar cache Redis do ativo no timestamp mais próximo do `expirationTime`.
   - Se não houver tick exato, usar interpolação linear ou o último tick disponível dentro de uma janela de ±2 segundos.
   - Logar método de obtenção do preço.
4. **Cálculo do Resultado:**
   - Se `direction == CALL`:
     - `exitPrice > entryPrice` -> WIN
     - `exitPrice < entryPrice` -> LOSS
     - `exitPrice == entryPrice` -> DRAW
   - Se `direction == PUT`:
     - `exitPrice < entryPrice` -> WIN
     - `exitPrice > entryPrice` -> LOSS
     - `exitPrice == entryPrice` -> DRAW
5. **Atualização Financeira (Transação):**
   - `trade.status = CLOSED`
   - `trade.result = WIN/LOSS/DRAW`
   - `trade.exitPrice = price`
   - Se WIN: `profit = amount * payoutRate`. `wallet.blockedBalance -= amount`. `wallet.balance += amount + profit`.
   - Se LOSS: `profit = -amount`. `wallet.blockedBalance -= amount`. (Saldo já estava debitado).
   - Se DRAW: `profit = 0`. `wallet.blockedBalance -= amount`. `wallet.balance += amount`.
   - Registrar `BalanceChange` (tipo: TRADE_RESULT).
6. **Hash de Auditoria:**
   - Gerar string concatenada: `tradeId|userId|entryPrice|exitPrice|amount|result|timestamp`.
   - Calcular SHA-256.
   - Salvar em `AuditLog` vinculado ao trade.
7. **Emissão de Eventos:**
   - WS: `trade:closed` para o usuário com resultado.
   - WS: `wallet:updated`.
8. **Log:** Registrar sucesso ou falha detalhadamente.

#### 6.3.3. Prevenção de Riscos
- **Manipulação:** Preços vêm de fonte externa (Twelve Data). O backend nunca gera preço sintético para definir resultado (exceto no modo fallback claramente sinalizado).
- **Latência:** O worker deve executar o mais próximo possível do expirationTime. BullMQ garante execução no delay exato ou imediatamente após se houver atraso.
- **Race Condition:** Usar transações SQL e locks otimistas no registro da wallet.
- **Replay Attack:** Cada trade tem ID único (CUID). WebSocket usa autenticação por JWT no handshake.

---

## PARTE 7 - DADOS DE MERCADO COM TWELVE DATA

### 7.1. Arquitetura do Serviço de Dados
- **Localização:** Módulo `MarketDataService` dentro do NestJS backend.
- **Princípio:** 1 conexão/serviço no backend consome a Twelve Data e distribui para N usuários via WebSocket próprio.

### 7.2. Estratégia de Cache (Redis)
- **Preços ao vivo (ticks):**
  - Chave: `tick:{assetSymbol}`
  - Valor: JSON `{ price, timestamp }`
  - TTL: 10 segundos (suficiente para fallback curto).
  - Frequência de atualização: A cada 5 segundos via polling REST ou WebSocket da Twelve Data (dependendo do plano).
- **Candles históricos:**
  - Chave: `candles:{assetSymbol}:{timeframe}` (ex: `candles:EURUSD:1m`)
  - Valor: Array JSON dos últimos 500 candles (Lightweight Charts format).
  - TTL: 1 hora.
  - Atualização: A cada 1 minuto buscar candle fechado e append no array.

### 7.3. Ativos Iniciais
| Par | Tipo | Twelve Data Symbol | Payout Inicial |
|-----|------|-------------------|----------------|
| EUR/USD | Forex | `EUR/USD` | 85% |
| USD/JPY | Forex | `USD/JPY` | 85% |
| GBP/USD | Forex | `GBP/USD` | 82% |
| USD/BRL | OTC / Forex | `USD/BRL` | 80% |

- **Nota sobre OTC:** Se a Twelve Data não oferecer dados OTC específicos, o ativo USD/BRL pode operar apenas durante horário de mercado forex (24h exceto fim de semana) ou usar simulação com base no último preço conhecido fora do horário.

### 7.4. Fallback em Caso de Limite Excedido
1. **Detecção:** Twelve Data retorna 429 (Too Many Requests) ou erro de créditos.
2. **Ativação:** Serviço entra em `SIMULATED_MODE` para o ativo afetado.
3. **Geração de Preço:** Random Walk baseado no último preço real conhecido.
   - `newPrice = lastPrice * (1 + (random(-0.0005, 0.0005)))`.
   - Volatilidade ajustada por ativo.
4. **Sinalização:**
   - Flag `isSimulated: true` no payload do WebSocket.
   - Frontend exibe ícone de alerta amarelo ao lado do ativo: "Dados simulados".
   - Log de auditoria indicando período de simulação.
5. **Recuperação:** Assim que a API voltar a responder, retomar dados reais.

### 7.5. Segurança da API Key
- **Localização:** Variável de ambiente `TWELVE_DATA_API_KEY` no servidor.
- **Restrições:**
  - Nunca expor no frontend.
  - Nunca logar a chave completa (mascarar nos logs: `tDA...9zX`).
  - Implementar circuit breaker: se 5 erros consecutivos, pausar chamadas por 60s.

### 7.6. Formato de Dados para o Frontend
O WS Server envia broadcast periódico:
```json
{
  "type": "TICK",
  "asset": "EUR/USD",
  "price": 1.08542,
  "timestamp": "2026-05-20T14:30:05.000Z",
  "isSimulated": false
}
```

E para candles:
```json
{
  "type": "CANDLE",
  "asset": "EUR/USD",
  "timeframe": "1m",
  "data": { "time": 1716215400, "open": 1.08540, "high": 1.08550, "low": 1.08530, "close": 1.08542 }
}
```

---

## PARTE 8 - INTEGRAÇÃO BSPAY (PIX)

### 8.1. Fluxo de Depósito
1. **Solicitação:** Usuário autenticado envia POST `/deposits` com `amount` (mínimo R$ 30, por exemplo).
2. **Validação:** Zod valida amount. Verificar se usuário tem KYC aprovado (se exigido para depósito).
3. **Criação na BSPAY:** Backend chama API BSPAY para criar cobrança PIX.
   - Payload: `amount`, `description`, `externalId` (nosso depositId).
4. **Resposta:** BSPAY retorna `transactionId`, `pixCode` (copia e cola), `qrCodeImage` (base64).
5. **Registro Local:** Criar registro `Transaction` tipo `DEPOSIT`, status `PENDING`, vinculado ao usuário.
6. **Retorno ao Frontend:** QR Code + copia e cola + tempo de expiração (ex: 30 minutos).
7. **Webhook de Confirmação:**
   - BSPAY envia POST para `https://api.dominio.com/webhooks/bspay`.
   - **Validação de Segurança:** Verificar header de assinatura/secret do webhook (se BSPAY suportar) ou validar `transactionId` via consulta na API BSPAY antes de creditar.
   - **Idempotência:** Verificar se `transactionId` já foi processado (unique constraint no banco).
   - **Processamento:**
     - Buscar `Transaction` pelo `externalId`.
     - Se status já `COMPLETED`, retornar 200 e ignorar.
     - Iniciar transação SQL.
     - `transaction.status = COMPLETED`.
     - `wallet.balance += amount`.
     - Registrar `BalanceChange`.
     - Commit.
   - **Notificações:**
     - WS: `wallet:updated` para o usuário.
     - n8n/Evolution API: Notificar usuário no Telegram/WhatsApp ("Depósito de R$ X confirmado!").

### 8.2. Fluxo de Saque
1. **Solicitação:** Usuário envia POST `/withdrawals` com `amount` e `pixKey`.
2. **Validações:**
   - `amount` dentro dos limites (mín R$ 50, máx R$ 10.000/dia).
   - `wallet.balance >= amount`.
   - `wallet.balance - wallet.blockedBalance >= amount` (não pode sacar valor bloqueado em trades abertos).
   - KYC aprovado obrigatório.
   - Validar formato da chave PIX (CPF, CNPJ, e-mail, celular, aleatória) via regex.
3. **Registro:** Criar `Transaction` tipo `WITHDRAWAL`, status `PENDING`.
4. **Débito Imediato (Congelamento):**
   - `wallet.balance -= amount`.
   - `wallet.blockedBalance += amount`.
   - Registrar `BalanceChange` (tipo: BLOCKED_FOR_WITHDRAWAL).
5. **Fila de Aprovação:**
   - n8n dispara notificação para admin no Telegram.
   - Admin acessa painel admin, vê saque na fila.
6. **Ação do Admin:**
   - **Aprovar:** Admin clica "Aprovar". Backend gera ordem de pagamento na BSPAY (se API de payout disponível) ou admin transfere manualmente. Após confirmação, `transaction.status = COMPLETED`, `wallet.blockedBalance -= amount`. Notificar usuário.
   - **Rejeitar:** Admin clica "Rejeitar" com motivo. `transaction.status = REJECTED`, `wallet.blockedBalance -= amount`, `wallet.balance += amount` (estorno). Notificar usuário com motivo.
7. **Histórico:** Endpoint GET `/transactions` retorna todas as transações do usuário com status.

### 8.3. Taxas e Limites
- **Taxa de depósito:** 0% (absorvida pela plataforma ou repassada - definir no MVP como 0% para atrair usuários).
- **Taxa de saque:** R$ 2,00 fixo ou 1% (configurável via painel admin).
- **Limites:**
  - Depósito mínimo: R$ 30.
  - Saque mínimo: R$ 50.
  - Saque máximo diário: R$ 10.000 (configurável por usuário no painel admin).

---

## PARTE 9 - PAINEL ADMINISTRATIVO

### 9.1. Autenticação e Acesso
- **Rota:** `/admin` (ou subdomínio `admin.dominio.com`).
- **Login:** E-mail e senha separados do sistema de usuários comuns (tabela `AdminUser`).
- **2FA Obrigatório:** TOTP (Google Authenticator/Authy) ativado no primeiro login.
- **Sessão:** JWT com tempo de vida curto (30 minutos), renovação automática em atividade.
- **Rate Limit:** Extremamente agressivo para `/admin/login` (5 tentativas por IP a cada 15 minutos).

### 9.2. Módulos do Painel

#### 9.2.1. Dashboard
- Cards: Total de usuários registrados, usuários ativos hoje (com trade), volume financeiro de hoje (soma de amounts), total em trades abertos agora, saques pendentes.
- Gráfico de linha: Novos usuários por dia (últimos 7 dias).
- Gráfico de barras: Volume de trades por hora (últimas 24h).
- Alertas: Caixa de entrada de eventos críticos (saque pendente, erro no motor, webhook falhou).

#### 9.2.2. Gestão de Usuários
- Tabela com: ID, nome, e-mail, saldo real, saldo demo, status KYC, data de cadastro, último login, status (ativo/banido).
- Ações: Ver detalhes, ver carteira, ver histórico de trades, banir/desbanir, resetar senha (envia e-mail), aprovar KYC.
- Filtros: Por data, por saldo, por status KYC.

#### 9.2.3. Gestão de Operações
- Visão em tempo real de todas as trades `PENDING` (contadores regressivos ao vivo via WS).
- Histórico de trades fechadas com filtros por usuário, ativo, resultado, data.
- Estatísticas por ativo: taxa de win/loss, volume total.
- **Importante:** Admin NÃO pode alterar resultado de trade fechada. Botão de "Cancelar trade pendente" apenas se estiver dentro de 5 segundos da criação (edge case).

#### 9.2.4. Gestão de Ativos e Payouts
- Lista de ativos: símbolo, nome, tipo, status (ativo/inativo), payout atual.
- Ação: Editar payout% (aplica-se a novas operações, não afeta pendentes).
- Ação: Ativar/desativar ativo (impede novas operações, mas mantém histórico).
- Adicionar novo ativo (para expansão futura).

#### 9.2.5. Gestão Financeira (Saques)
- Fila de saques pendentes: ID, usuário, valor, chave PIX, data solicitação.
- Ações em massa: Aprovar selecionados, rejeitar selecionados.
- Ao aprovar: Modal para upload de comprovante (se pagamento manual) ou confirmação de ordem BSPAY.
- Histórico de saques processados.

#### 9.2.6. Monitoramento Twelve Data
- Créditos restantes do dia (se API da Twelve Data permitir consulta).
- Última hora de atualização por ativo.
- Status atual: REAL ou SIMULADO por ativo.
- Log de erros de conexão.

#### 9.2.7. Logs e Auditoria
- Tabela `AuditLog`: Timestamp, usuário, ação, entidade, hash, IP.
- Filtros por data, usuário, tipo de ação.
- Logs de erro do sistema (filtrados por severidade).
- **Imutabilidade:** Logs de auditoria NUNCA podem ser deletados ou editados pelo painel. Apenas visualização.

#### 9.2.8. Permissões de Admin
- **Super Admin:** Acesso total.
- **Financeiro:** Apenas saques, depósitos, carteiras. Não vê senhas nem pode banir.
- **Suporte:** Apenas visualiza usuários, histórico, pode aprovar KYC. Não vê saques nem edita payouts.
- **Analista:** Apenas dashboard e relatórios. Somente leitura.

---

## PARTE 10 - SEGURANÇA (Checklist Completo)

### 10.1. Atualização e Hardening de Infra
- [ ] **Docker:** Atualizar para versão estável mais recente (25.x+).
- [ ] **Sistema Operacional:** `apt update && apt upgrade` semanal automatizado (unattended-upgrades apenas para segurança).
- [ ] **Kernel:** Manter atualizado via DO.

### 10.2. Firewall e Rede
- [ ] **UFW/iptables:** Abrir apenas portas 80 (HTTP), 443 (HTTPS), 22 (SSH).
- [ ] **SSH:**
  - Alterar porta padrão (ex: 2222).
  - Desabilitar login root.
  - Autenticação apenas por chave SSH (desabilitar password auth).
  - Instalar fail2ban para brute force SSH.
- [ ] **EasyPanel:** Restringir acesso por IP whitelist. Porta não padrão.

### 10.3. SSL/TLS
- [ ] **Certificado:** Let's Encrypt via Nginx (certbot) ou Cloudflare Origin CA.
- [ ] **Configuração TLS:** TLS 1.2 mínimo, 1.3 preferido. Ciphers fortes.
- [ ] **HSTS:** Header Strict-Transport-Security ativado.

### 10.4. Aplicação (NestJS/Next.js)
- [ ] **Helmet:** Headers de segurança (X-Frame-Options, X-Content-Type-Options, CSP, etc.).
- [ ] **CORS:** Permitir apenas `https://dominio.com` e `https://www.dominio.com`.
- [ ] **Rate Limiting:**
  - Login: 5 tentativas / 15 min / IP.
  - API geral: 100 req / min / usuário.
  - Criar trade: 10 req / min / usuário (evita spam).
- [ ] **Validação de Input:** Zod em 100% dos endpoints. Nunca confiar no frontend.
- [ ] **SQL Injection:** Protegido pelo Prisma (query parameterization), mas nunca usar `$queryRaw` com inputs não sanitizados.
- [ ] **XSS:** Next.js escapa automaticamente, mas sanitizar qualquer HTML renderizado (DOMPurify se necessário).
- [ ] **CSRF:** Protegido por JWT em header e CORS restrito. Para cookies, usar SameSite=Strict.

### 10.5. Autenticação e Autorização
- [ ] **Senhas:** Mínimo 8 caracteres, complexidade média. bcrypt rounds 12.
- [ ] **JWT:**
  - Access Token: 15 minutos.
  - Refresh Token: 7 dias, armazenado em cookie httpOnly secure.
  - Blacklist de tokens no Redis (para logout imediato).
- [ ] **2FA Admin:** TOTP obrigatório.
- [ ] **2FA Usuário (Futuro):** Opcional no MVP, mas estrutura preparada.

### 10.6. Dados e Privacidade
- [ ] **LGPD:**
  - Termos de uso e política de privacidade disponíveis no cadastro.
  - Consentimento explícito para processamento de dados.
  - Endpoint para usuário solicitar exportação/deleção de dados (direito ao esquecimento - implementar no pós-MVP se necessário, mas ter política definida).
- [ ] **Criptografia:**
  - Senhas: bcrypt.
  - Dados sensíveis no banco (PIX keys, documentos KYC): criptografar com AES-256 (chave em variável de ambiente).
  - Comunicação: HTTPS obrigatório.

### 10.7. Auditoria e Logs
- [ ] **Logs de Auditoria:** Tabela imutável no PostgreSQL. Registrar: criação de trade, fechamento de trade, depósito, saque, login, logout, alteração de payout por admin, aprovação de KYC.
- [ ] **Logs de Sistema:** Winston rotacionando arquivos (ou enviando para serviço externo futuramente).
- [ ] **Hash de Integridade:** Cada registro de trade fechado gera hash SHA-256 que pode ser verificado externamente para provar que não houve alteração.

### 10.8. Backups
- [ ] **PostgreSQL:** Backup diário automático via EasyPanel ou script cron com `pg_dump`.
- [ ] **Redis:** AOF + snapshot periódico. Backup do arquivo AOF.
- [ ] **Destino:** Armazenar backups em bucket S3-compatible (DigitalOcean Spaces) ou outro servidor.
- [ ] **Retenção:** 7 backups diários, 4 semanais, 12 mensais.
- [ ] **Teste de Restauração:** Realizar restore em ambiente local a cada mês.

### 10.9. Secrets Management
- [ ] **Nunca commitar secrets.** Usar `.env.example` no repositório.
- [ ] **Produção:** Secrets injetados via variáveis de ambiente do Docker/EasyPanel.
- [ ] **Rotação:** Política de rotação de API keys a cada 90 dias.

---

## PARTE 11 - ROADMAP POR FASES (~14 semanas)

### FASE 1 - PREPARAÇÃO DA INFRAESTRUTURA (Semana 1)
**Objetivo:** Ambiente seguro e funcional para desenvolvimento e produção.
- [ ] Atualizar Docker no VPS para versão mais recente.
- [ ] Configurar Docker networks internas e limites de recursos.
- [ ] Subir PostgreSQL 15 e Redis 7 via Docker Compose no EasyPanel.
- [ ] Configurar Nginx como reverse proxy com SSL Let's Encrypt.
- [ ] Configurar Cloudflare (DNS, SSL full strict, DDoS básico).
- [ ] Hardening: SSH por chave, fail2ban, UFW, senhas fortes, 2FA EasyPanel.
- [ ] Criar repositórios GitHub privados: `frontend`, `backend` (ou monorepo `platform`).
- [ ] Configurar branch protection e GitHub Secrets.
- [ ] Configurar backups automáticos do PostgreSQL para DO Spaces.
- [ ] Subir n8n e Evolution API em containers separados.

### FASE 2 - PROTÓTIPO VISUAL E ESTRUTURA FRONTEND (Semanas 2-3)
**Objetivo:** Interface visual completa, sem lógica de backend, usando dados mockados.
- [ ] Setup Next.js 14 + TypeScript + Tailwind + shadcn/ui.
- [ ] Implementar layout de 3 colunas (sidebar + gráfico + painel).
- [ ] Implementar Header (logo, toggle demo/real, saldo, depósito/retirada).
- [ ] Implementar Sidebar com navegação (Trade, Conta, Ajuda - demais itens mockados).
- [ ] Integrar TradingView Lightweight Charts com dados mockados (candles estáticos).
- [ ] Implementar painel direito: seletor de tempo, investimento, botões CALL/PUT, lista de operações mockadas.
- [ ] Implementar dark mode com paleta definida.
- [ ] Tela de login/cadastro estática.
- [ ] Responsividade básica (para 100 usuários, desktop é prioridade, mas mobile deve ser usável).

### FASE 3 - BACKEND BASE: AUTENTICAÇÃO, USUÁRIOS, CARTEIRA (Semanas 4-5)
**Objetivo:** Sistema de contas e carteiras funcional.
- [ ] Setup NestJS + Prisma + PostgreSQL.
- [ ] Definir schema Prisma completo (User, Wallet, Trade, Asset, Transaction, AuditLog, AdminUser).
- [ ] Rodar primeira migration.
- [ ] Implementar módulo de Auth: registro, login, JWT (access + refresh), logout.
- [ ] Implementar middleware de rate limit no login.
- [ ] Implementar módulo de Usuários: perfil, upload de documentos KYC (salvar path/arquivo).
- [ ] Implementar módulo de Carteira: criar wallet demo e real automaticamente no cadastro, consultar saldo.
- [ ] Seed de ativos iniciais no banco.
- [ ] Conectar frontend ao backend (login funcional, saldo vindo da API).

### FASE 4 - INTEGRAÇÃO TWELVE DATA: GRÁFICO COM DADOS REAIS (Semana 6)
**Objetivo:** Gráfico mostrando dados de mercado reais.
- [ ] Criar `MarketDataService` no NestJS.
- [ ] Implementar polling da Twelve Data REST API (preços e candles).
- [ ] Salvar no Redis com TTL adequado.
- [ ] Criar Gateway WebSocket no NestJS para broadcast de ticks e candles.
- [ ] Conectar frontend ao WS: gráfico atualizando em tempo real.
- [ ] Implementar cache agressivo e fallback simulado.
- [ ] Adicionar indicador visual no frontend quando dados estiverem em modo simulado.

### FASE 5 - MOTOR DE OPERAÇÕES DEMO (Semanas 7-8)
**Objetivo:** Usuários conseguem operar com dinheiro demo e ver resultados.
- [ ] Implementar endpoint `POST /trades` com todas as validações.
- [ ] Implementar congelamento de saldo demo.
- [ ] Configurar BullMQ com Redis para filas.
- [ ] Implementar `TradeExpirationWorker`.
- [ ] Integrar worker com preços de mercado (do cache Redis).
- [ ] Implementar cálculo WIN/LOSS/DRAW e atualização de saldo demo.
- [ ] Implementar hash de auditoria.
- [ ] Emitir eventos WebSocket para atualização de trades e saldo em tempo real.
- [ ] Lista de trades abertas e histórico funcionando no frontend.
- [ ] Testes de carga: simular 50 usuários criando trades simultaneamente.

### FASE 6 - INTEGRAÇÃO BSPAY: CONTA REAL, DEPÓSITO PIX, SAQUE (Semanas 9-10)
**Objetivo:** Fluxo financeiro real completo.
- [ ] Integrar API BSPAY: criar cobrança PIX.
- [ ] Implementar tela de depósito no frontend (valor, gerar QR Code).
- [ ] Implementar webhook `/webhooks/bspay` com validação e idempotência.
- [ ] Implementar crédito automático de saldo real.
- [ ] Implementar solicitação de saque no frontend e backend.
- [ ] Implementar fila de aprovação de saques no painel admin.
- [ ] Integrar n8n para notificar admin no Telegram sobre saques pendentes.
- [ ] Histórico de transações (depósitos e saques) no perfil do usuário.
- [ ] Toggle Demo/Real funcional e independente.

### FASE 7 - PAINEL ADMINISTRATIVO (Semana 11)
**Objetivo:** Controle operacional da plataforma.
- [ ] Criar schema e seed de usuários admin com roles.
- [ ] Implementar login admin com 2FA TOTP.
- [ ] Construir dashboard com KPIs.
- [ ] Tabela de usuários com filtros e ações (banir, aprovar KYC).
- [ ] Tabela de trades em tempo real e histórico.
- [ ] Gestão de ativos (editar payout, ativar/desativar).
- [ ] Fila de saques com aprovação/rejeição.
- [ ] Visualização de logs de auditoria (somente leitura).
- [ ] Middleware de autorização por role (Super Admin, Financeiro, Suporte).

### FASE 8 - SEGURANÇA E AUDITORIA (Semana 12)
**Objetivo:** Endurecer a plataforma para ambiente de produção com dinheiro real.
- [ ] Revisão completa de headers Helmet e CORS.
- [ ] Implementar rate limiting em todos os endpoints sensíveis.
- [ ] Revisar todas as queries Prisma para garantir que não há SQL injection.
- [ ] Criptografar dados sensíveis no banco (PIX keys).
- [ ] Implementar hash SHA-256 em todos os registros de trade fechado.
- [ ] Configurar logs de auditoria para todas as ações financeiras.
- [ ] Teste de penetração básico (OWASP ZAP ou similar) nos endpoints públicos.
- [ ] Revisar configurações de Docker (usuário não-root, limites de recurso).
- [ ] Documentar procedimento de backup e restore.

### FASE 9 - TESTES E HOMOLOGAÇÃO (Semana 13)
**Objetivo:** Garantir que tudo funciona antes de receber usuários reais.
- [ ] Testes unitários críticos: motor de trade, cálculo de payout, webhook BSPAY.
- [ ] Testes de integração: fluxo completo de depósito -> trade -> saque.
- [ ] Teste de carga com 100 usuários simultâneos (usar Artillery ou k6).
- [ ] Verificar consumo de créditos Twelve Data em cenário de pico.
- [ ] Testar fallback de dados simulados.
- [ ] Testar restore de backup.
- [ ] Revisão de copy/textos da interface (ortografia, clareza).
- [ ] Testar em múltiplos navegadores (Chrome, Firefox, Edge).

### FASE 10 - BETA FECHADO (Semanas 14-15)
**Objetivo:** Validação com usuários reais controlados.
- [ ] Convidar 10-20 usuários de confiança.
- [ ] Fornecer saldo demo ilimitado para testes.
- [ ] Liberar depósitos mínimos (R$ 30) para teste real.
- [ ] Canal de suporte direto (Telegram/WhatsApp) para feedback.
- [ ] Monitorar logs de erro em tempo real.
- [ ] Coletar feedback de UX (o que é confuso, o que falta).
- [ ] Ajustar payout/tempos de expiração com base no comportamento.
- [ ] Corrigir bugs críticos identificados.
- [ ] **GO/NO-GO:** Se estável por 7 dias consecutivos, abrir para lista de espera.

---

## APÊNDICE A - ESTRUTURA DE DIRETÓRIOS SUGERIDA (Monorepo)

```
/trading-platform
├── /apps
│   ├── /web                  # Next.js frontend
│   │   ├── /src
│   │   │   ├── /app          # App Router (Next.js 14)
│   │   │   ├── /components   # shadcn/ui + custom
│   │   │   ├── /lib          # Utils, hooks
│   │   │   └── /stores       # Zustand stores
│   │   └── package.json
│   ├── /api                  # NestJS backend
│   │   ├── /src
│   │   │   ├── /auth
│   │   │   ├── /users
│   │   │   ├── /wallet
│   │   │   ├── /trading
│   │   │   ├── /market-data
│   │   │   ├── /admin
│   │   │   ├── /webhooks
│   │   │   ├── /common       # Guards, Interceptors, Pipes
│   │   │   └── /prisma       # Schema + migrations
│   │   └── package.json
│   └── /admin-panel          # Next.js painel admin (ou /web/src/app/admin)
├── /packages
│   └── /shared-types         # Tipos TypeScript compartilhados
├── /infra
│   ├── docker-compose.yml
│   ├── /nginx
│   └── /scripts
├── .env.example
└── README.md
```

## APÊNDICE B - VARIÁVEIS DE AMBIENTE ESSENCIAIS (.env.example)

```bash
# App
NODE_ENV=production
APP_URL=https://seusite.com
API_URL=https://api.seusite.com

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/tradingdb?schema=public"

# Redis
REDIS_URL="redis://:password@localhost:6379"

# JWT
JWT_SECRET="super_secret_min_32_chars_long"
JWT_REFRESH_SECRET="another_super_secret_min_32_chars"

# Twelve Data
TWELVE_DATA_API_KEY="sua_chave_aqui"

# BSPAY
BSPAY_API_KEY="sua_chave_bspay"
BSPAY_WEBHOOK_SECRET="segredo_para_validar_webhook"

# Admin
ADMIN_2FA_ENFORCED=true

# n8n / Evolution (se necessário)
N8N_WEBHOOK_URL="https://n8n.seusite.com/webhook/..."
EVOLUTION_API_KEY="..."
```

---

**Documento elaborado para volume de 100 usuários simultâneos, priorizando segurança, simplicidade operacional e auditabilidade. Este plano deve ser revisado ao final de cada fase para ajustes de escopo.**