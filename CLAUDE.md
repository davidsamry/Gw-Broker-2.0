# GW Broker — Instruções para Claude

## O que é este projeto

Plataforma de opções digitais (binárias) com dinheiro real. A referência de UX/layout é a Quotex — replicar a experiência e estrutura de telas, nunca código ou marca.

Fundador: iniciante em programação. Claude faz a maior parte do trabalho técnico. Respostas devem ser diretas e orientadas a execução.

## Stack de infraestrutura

- **VPS**: DigitalOcean + EasyPanel (gerenciamento de serviços)
- **Banco**: Postgres (via EasyPanel)
- **Cache**: Redis (via EasyPanel)
- **Automações**: n8n
- **Mensageria**: Evolution API (WhatsApp/Telegram)
- **Dados de mercado**: Twelve Data (créditos limitados — usar com cuidado)
- **Versionamento**: GitHub
- **Docker**: instalado mas DESATUALIZADO — atualizar antes de qualquer deploy
- **MCP ativos**: Supabase, Vercel, n8n

## Regras críticas

1. **Nunca expor a API Key do Twelve Data no frontend** — sempre via backend
2. **Nunca usar `rm -rf`, `DROP TABLE` ou `git push --force` sem confirmação explícita**
3. **Commits frequentes** — antes de qualquer mudança grande, garantir que o código atual está commitado
4. **Segurança primeiro** — qualquer feature que lide com dinheiro real precisa de validação dupla
5. **Docker desatualizado** — alertar se qualquer comando depender de versão específica do Docker

## Fases do projeto (roadmap 2026)

1. **Preparação de infraestrutura** — atualizar Docker, configurar Traefik, Cloudflare, SSL
2. **Protótipo visual** — layout inspirado na Quotex, identidade GW Broker
3. **Backend base** — APIs, autenticação, banco de dados
4. **Integração Twelve Data** — gráficos em tempo real
5. **Motor de operações** — conta demo + conta real
6. **Painel administrativo**
7. **Segurança, logs, auditoria**
8. **Testes e homologação**
9. **Beta fechado**

Priorizar sempre o que desbloqueia a próxima fase.

## MVP obrigatório (mínimo para operar)

- Conta demo + conta real
- Gráficos em tempo real (Twelve Data)
- Motor de operações (comprar opção, expirar, calcular resultado)
- Carteira interna (saldo demo e real)
- Painel admin básico
- KYC básico
- Gateway de pagamentos

## Decisões técnicas já tomadas

- Gateway: Stripe ou Adyen (internacional); Mercado Pago se foco for Brasil
- KYC: Sumsub ou Veriff
- Adicionar: Cloudflare (CDN + proteção), Traefik (reverse proxy + SSL), Grafana + Prometheus (monitoramento)

## Como trabalhar comigo

- Sempre me diga em qual fase estamos antes de implementar algo novo
- Se uma tarefa puder quebrar algo em produção, me avise antes de executar
- Prefiro código funcional simples a código elegante complexo
- Quando houver dúvida entre duas abordagens, explique em linguagem simples e recomende uma
