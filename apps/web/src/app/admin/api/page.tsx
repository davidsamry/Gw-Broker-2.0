'use client'

// Admin: Bot API overview + interactive tester.
//
// Top half is the documentation (URL, endpoints, curl snippets, status
// codes, flow). Each endpoint card has a built-in "Testar" form so the
// admin can fire real requests against the API without leaving the page.
//
// The tester maintains an in-memory bot session: a successful /login
// stores the access + refresh tokens and pre-fills the Authorization
// header on every subsequent call. A small banner shows the current
// session state and a "Limpar" button clears it.

import { useEffect, useMemo, useState } from 'react'
import {
  Plug, Download, Copy, Check, ShieldCheck, Globe, Clock, AlertTriangle,
  Play, X, KeyRound, LogOut,
} from 'lucide-react'

// ── Endpoint catalogue ──────────────────────────────────────────────────────
//
// Each endpoint declares its method, path, summary, auth requirement, the
// curl snippet shown in the docs panel, and the form schema used by the
// interactive tester. Keeping everything in one config means the docs
// view and the tester can't drift apart.

type FieldType = 'text' | 'password' | 'number' | 'select' | 'textarea'

interface Field {
  name:         string
  label:        string
  type:         FieldType
  placeholder?: string
  default?:     string
  options?:     { value: string; label: string }[]
  // If true, the tester won't send the field when it's empty (used for
  // optional query params on /trades).
  optional?:    boolean
}

interface Endpoint {
  key:     string
  method:  'GET' | 'POST'
  path:    string
  summary: string
  auth:    boolean
  curl:    (base: string) => string
  fields:  Field[]
  // Builds the fetch request from the form state. `tokens` is null when
  // not logged in. Returns the URL + RequestInit ready for fetch().
  build:   (state: Record<string, string>, tokens: BotSession | null, base: string) =>
           { url: string; init: RequestInit }
}

interface BotSession {
  access_token:  string
  refresh_token: string
  email:         string
  // Wall-clock epoch (ms) of issue. Used to show "expires in X min".
  issued_at:     number
}

function ENDPOINTS(base: string): Endpoint[] {
  return [
    {
      key: 'login', method: 'POST', path: '/login', auth: false,
      summary: 'Autentica e retorna access_token (1h) + refresh_token (30d).',
      curl: (b) => `curl -X POST ${b}/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"usuario@email.com","password":"sua-senha"}'`,
      fields: [
        { name: 'email',    label: 'Email',  type: 'text',     placeholder: 'usuario@email.com' },
        { name: 'password', label: 'Senha',  type: 'password', placeholder: '••••••••' },
      ],
      build: (s) => ({
        url:  `${base}/login`,
        init: {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email: s.email, password: s.password }),
        },
      }),
    },
    {
      key: 'refresh', method: 'POST', path: '/refresh', auth: false,
      summary: 'Renova o access_token usando o refresh_token. Rotaciona o refresh.',
      curl: (b) => `curl -X POST ${b}/refresh \\
  -H "Content-Type: application/json" \\
  -d '{"refresh_token":"SEU_REFRESH_TOKEN"}'`,
      fields: [
        { name: 'refresh_token', label: 'Refresh token', type: 'textarea', placeholder: 'Cole o refresh_token aqui (auto-preenche se você já fez login)' },
      ],
      build: (s) => ({
        url:  `${base}/refresh`,
        init: {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ refresh_token: s.refresh_token }),
        },
      }),
    },
    {
      key: 'profile', method: 'GET', path: '/profile', auth: true,
      summary: 'Dados completos do perfil + saldos (REAL e DEMO).',
      curl: (b) => `curl ${b}/profile \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
      fields: [],
      build: (_s, tokens) => ({
        url:  `${base}/profile`,
        init: { headers: { Authorization: `Bearer ${tokens?.access_token ?? ''}` } },
      }),
    },
    {
      key: 'balance', method: 'GET', path: '/balance', auth: true,
      summary: 'Saldo da conta REAL + bônus + estado do rollover.',
      curl: (b) => `curl ${b}/balance \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
      fields: [],
      build: (_s, tokens) => ({
        url:  `${base}/balance`,
        init: { headers: { Authorization: `Bearer ${tokens?.access_token ?? ''}` } },
      }),
    },
    {
      key: 'assets', method: 'GET', path: '/assets', auth: true,
      summary: 'Lista ativos disponíveis para trading (Binance, com payout do admin).',
      curl: (b) => `curl ${b}/assets \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
      fields: [],
      build: (_s, tokens) => ({
        url:  `${base}/assets`,
        init: { headers: { Authorization: `Bearer ${tokens?.access_token ?? ''}` } },
      }),
    },
    {
      key: 'trade', method: 'POST', path: '/trade', auth: true,
      summary: 'Abre operação binária. Stake debita da conta REAL imediatamente.',
      curl: (b) => `curl -X POST ${b}/trade \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"BTCUSDT","direction":"up","stake":10,"duration_seconds":60}'`,
      fields: [
        { name: 'symbol',           label: 'Símbolo',    type: 'text',   placeholder: 'BTCUSDT', default: 'BTCUSDT' },
        { name: 'direction',        label: 'Direção',    type: 'select', default: 'up', options: [
          { value: 'up',   label: 'Para cima (call)' },
          { value: 'down', label: 'Para baixo (put)' },
        ] },
        { name: 'stake',            label: 'Stake (R$)', type: 'number', default: '10', placeholder: '10' },
        { name: 'duration_seconds', label: 'Duração',    type: 'select', default: '60', options: [
          { value: '60',  label: '60 segundos' },
          { value: '300', label: '5 minutos' },
          { value: '900', label: '15 minutos' },
        ] },
      ],
      build: (s, tokens) => ({
        url:  `${base}/trade`,
        init: {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${tokens?.access_token ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            symbol:           s.symbol,
            direction:        s.direction,
            stake:            parseFloat(s.stake) || 0,
            duration_seconds: parseInt(s.duration_seconds, 10) || 60,
          }),
        },
      }),
    },
    {
      key: 'trades', method: 'GET', path: '/trades?status=open&limit=50&offset=0', auth: true,
      summary: 'Histórico de operações. status: open | closed | all.',
      curl: (b) => `curl "${b}/trades?status=open&limit=50&offset=0" \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
      fields: [
        { name: 'status', label: 'Status', type: 'select', default: 'all', options: [
          { value: 'all',    label: 'Todas' },
          { value: 'open',   label: 'Em aberto' },
          { value: 'closed', label: 'Fechadas' },
        ] },
        { name: 'limit',  label: 'Limit',  type: 'number', default: '50' },
        { name: 'offset', label: 'Offset', type: 'number', default: '0' },
      ],
      build: (s, tokens) => {
        const q = new URLSearchParams({ status: s.status, limit: s.limit, offset: s.offset })
        return {
          url:  `${base}/trades?${q}`,
          init: { headers: { Authorization: `Bearer ${tokens?.access_token ?? ''}` } },
        }
      },
    },
    {
      key: 'trade-by-id', method: 'GET', path: '/trade/:id', auth: true,
      summary: 'Detalhes de uma operação específica (sempre do usuário autenticado).',
      curl: (b) => `curl ${b}/trade/UUID_DA_OPERACAO \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
      fields: [
        { name: 'id', label: 'ID da operação', type: 'text', placeholder: 'cmph2r1cb000zepzsqm6d7js2' },
      ],
      build: (s, tokens) => ({
        url:  `${base}/trade/${encodeURIComponent(s.id)}`,
        init: { headers: { Authorization: `Bearer ${tokens?.access_token ?? ''}` } },
      }),
    },
  ]
}

const STATUS_CODES: Array<{ code: number; label: string }> = [
  { code: 200, label: 'Sucesso' },
  { code: 201, label: 'Recurso criado (operação aberta)' },
  { code: 400, label: 'Requisição inválida / validação falhou' },
  { code: 401, label: 'Token inválido ou ausente' },
  { code: 403, label: 'Conta bloqueada' },
  { code: 404, label: 'Recurso não encontrado' },
  { code: 429, label: 'Rate limit ou throttle de operações' },
  { code: 500, label: 'Erro interno do servidor' },
]

// ── Page ────────────────────────────────────────────────────────────────────

export default function AdminApiPage() {
  // Base URL: inferred from NEXT_PUBLIC_API_URL so the page shows the
  // URL bots will actually call. Falls back to a localhost default.
  const [base, setBase] = useState('https://api.example.com/bot/v1')
  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    setBase(`${api.replace(/\/$/, '')}/bot/v1`)
  }, [])

  // Bot session — populated by a successful /login; cleared by Logout.
  // Lives in component state only (not persisted) — refresh wipes it on
  // purpose so credentials don't sit in storage on a shared admin browser.
  const [session, setSession] = useState<BotSession | null>(null)

  const endpoints = useMemo(() => ENDPOINTS(base), [base])

  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedKey(key)
        setTimeout(() => setCopiedKey(null), 1500)
      },
      () => { /* permission denied — ignore */ },
    )
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
          <Plug size={18} />
        </div>
        <div className="flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-white">API de Trading para Bots</h1>
          <p className="text-sm text-[#8b8f9a] mt-1">
            Endpoints REST para integração com bots, automações e scripts externos.
            Mesmas regras de negócio do front (rollover, min/max, throttle).
          </p>
        </div>
        <a
          href="/api-documentation.pdf"
          download
          className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
        >
          <Download size={14} />
          Baixar PDF
        </a>
      </div>

      {/* Base URL */}
      <div className="mb-4 rounded-xl border border-[#2a2e3b] bg-[#1d2130] p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#8b8f9a] mb-2">
          <Globe size={12} /> URL base
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 rounded-lg bg-[#0d1117] border border-[#2a2e3b] text-[13px] text-blue-300 font-mono break-all">
            {base}
          </code>
          <button
            onClick={() => copy(base, 'base')}
            className="px-3 py-2 rounded-lg bg-[#252a3a] hover:bg-[#2d3344] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            {copiedKey === 'base' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copiedKey === 'base' ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>

      {/* Bot session banner — visible always so the admin knows whether
          the tester is authenticated or not. */}
      <SessionBanner session={session} onClear={() => setSession(null)} />

      {/* Auth + rate-limit highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Highlight icon={<ShieldCheck size={14} className="text-emerald-400" />} title="Autenticação" body="JWT no header Authorization: Bearer TOKEN. Access expira em 1h." />
        <Highlight icon={<Clock      size={14} className="text-blue-400" />}     title="Refresh"        body="Refresh token opaco (30d), rotacionado a cada uso. Revogue via DB se vazar." />
        <Highlight icon={<AlertTriangle size={14} className="text-amber-400" />} title="Rate limit"   body="5 tentativas de login / 5min por IP. Throttle de 1s entre operações." />
      </div>

      {/* Endpoints */}
      <div className="space-y-3 mb-8">
        <h2 className="text-base font-bold text-white mb-2">Endpoints</h2>
        {endpoints.map((ep) => (
          <EndpointCard
            key={ep.key}
            endpoint={ep}
            base={base}
            session={session}
            onSessionChange={setSession}
            copy={copy}
            copiedKey={copiedKey}
          />
        ))}
      </div>

      {/* Status codes */}
      <div className="rounded-xl border border-[#2a2e3b] bg-[#1d2130] p-4 mb-6">
        <h2 className="text-base font-bold text-white mb-3">Códigos de status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {STATUS_CODES.map((s) => (
            <div key={s.code} className="flex items-center gap-2.5 text-[12.5px]">
              <code className="font-mono text-blue-300 font-bold w-9">{s.code}</code>
              <span className="text-[#bdc1cf]">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recommended flow */}
      <div className="rounded-xl border border-[#2a2e3b] bg-[#1d2130] p-4 mb-6">
        <h2 className="text-base font-bold text-white mb-3">Fluxo recomendado para bots</h2>
        <ol className="space-y-2 text-[13px] text-[#bdc1cf] list-decimal pl-5">
          <li>POST <code className="text-blue-300">/login</code> — armazene access_token + refresh_token.</li>
          <li>GET <code className="text-blue-300">/assets</code> — descubra os símbolos válidos e payouts atuais.</li>
          <li>GET <code className="text-blue-300">/balance</code> — verifique saldo antes de cada operação.</li>
          <li>POST <code className="text-blue-300">/trade</code> — abra a operação. Resposta inclui <code>new_balance</code>.</li>
          <li>GET <code className="text-blue-300">/trades?status=open</code> — acompanhe operações em aberto.</li>
          <li>GET <code className="text-blue-300">/trade/:id</code> — busque o resultado após o <code>expires_at</code>.</li>
          <li>POST <code className="text-blue-300">/refresh</code> — antes de 1h, renove o access_token.</li>
        </ol>
      </div>

      {/* Download CTA on mobile (top button is hidden on small screens) */}
      <div className="sm:hidden mb-6">
        <a
          href="/api-documentation.pdf"
          download
          className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
        >
          <Download size={14} />
          Baixar documentação (PDF)
        </a>
      </div>
    </div>
  )
}

// ── Endpoint card with inline tester ────────────────────────────────────────

interface TestResponse {
  status: number
  ok:     boolean
  body:   unknown
  timeMs: number
  error?: string
}

function EndpointCard({
  endpoint, base, session, onSessionChange, copy, copiedKey,
}: {
  endpoint:        Endpoint
  base:            string
  session:         BotSession | null
  onSessionChange: (s: BotSession | null) => void
  copy:            (text: string, key: string) => void
  copiedKey:       string | null
}) {
  const [expanded, setExpanded] = useState(false)

  // Seed form state from declared defaults so the form is usable on the
  // first click (especially the /trade dropdowns which need a default
  // selection).
  const [formState, setFormState] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const f of endpoint.fields) initial[f.name] = f.default ?? ''
    return initial
  })

  const [response, setResponse] = useState<TestResponse | null>(null)
  const [loading, setLoading]   = useState(false)

  // Auto-pre-fill the refresh token field with the current session's
  // refresh_token whenever the form opens — saves the admin from copy-
  // pasting it. Doesn't overwrite a value they've already typed.
  useEffect(() => {
    if (endpoint.key === 'refresh' && expanded && session && !formState.refresh_token) {
      setFormState((prev) => ({ ...prev, refresh_token: session.refresh_token }))
    }
  }, [endpoint.key, expanded, session, formState.refresh_token])

  async function send() {
    setLoading(true)
    setResponse(null)
    const t0 = performance.now()
    try {
      const { url, init } = endpoint.build(formState, session, base)
      const res = await fetch(url, init)
      const text = await res.text()
      let body: unknown
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      const timeMs = Math.round(performance.now() - t0)

      // Side effects on success.
      if (res.ok && endpoint.key === 'login' && typeof body === 'object' && body) {
        const b = body as { access_token?: string; refresh_token?: string; user?: { email?: string } }
        if (b.access_token && b.refresh_token) {
          onSessionChange({
            access_token:  b.access_token,
            refresh_token: b.refresh_token,
            email:         b.user?.email ?? formState.email ?? '',
            issued_at:     Date.now(),
          })
        }
      }
      if (res.ok && endpoint.key === 'refresh' && typeof body === 'object' && body) {
        const b = body as { access_token?: string; refresh_token?: string }
        if (b.access_token && b.refresh_token) {
          onSessionChange({
            access_token:  b.access_token,
            refresh_token: b.refresh_token,
            email:         session?.email ?? '',
            issued_at:     Date.now(),
          })
        }
      }

      setResponse({ status: res.status, ok: res.ok, body, timeMs })
    } catch (err: any) {
      const timeMs = Math.round(performance.now() - t0)
      setResponse({ status: 0, ok: false, body: null, timeMs, error: err?.message ?? 'Falha de rede' })
    } finally {
      setLoading(false)
    }
  }

  const needsAuth   = endpoint.auth && !session
  const curlSnippet = endpoint.curl(base)

  return (
    <div className="rounded-xl border border-[#2a2e3b] bg-[#1d2130] overflow-hidden">
      {/* Header row */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-[#2a2e3b]">
        <span className={methodClass(endpoint.method)}>{endpoint.method}</span>
        <code className="text-sm font-mono text-white truncate">{endpoint.path}</code>
        {endpoint.auth
          ? <span className="ml-auto text-[10px] font-bold tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">AUTH</span>
          : <span className="ml-auto text-[10px] font-bold tracking-wider text-[#8b8f9a] bg-[#252a3a] border border-[#2a2e3b] rounded-full px-2 py-0.5">PÚBLICO</span>
        }
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-[13px] text-[#bdc1cf] mb-3">{endpoint.summary}</p>

        {/* Curl snippet */}
        <div className="relative mb-3">
          <pre className="overflow-x-auto rounded-lg bg-[#0d1117] border border-[#2a2e3b] px-3 py-2.5 text-[11.5px] text-[#cdd3df] font-mono leading-relaxed">
{curlSnippet}
          </pre>
          <button
            onClick={() => copy(curlSnippet, `curl-${endpoint.key}`)}
            className="absolute top-1.5 right-1.5 px-2 py-1 rounded-md bg-[#252a3a]/90 hover:bg-[#2d3344] text-white text-[10px] font-semibold flex items-center gap-1 transition-colors"
          >
            {copiedKey === `curl-${endpoint.key}` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            {copiedKey === `curl-${endpoint.key}` ? 'Copiado' : 'Copiar'}
          </button>
        </div>

        {/* Tester toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className={
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ' +
            (expanded
              ? 'bg-[#252a3a] text-white border border-[#3a3f50] hover:border-white/30'
              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/15')
          }
        >
          {expanded ? <X size={12} /> : <Play size={12} />}
          {expanded ? 'Fechar testador' : 'Testar'}
        </button>

        {/* Inline tester */}
        {expanded && (
          <div className="mt-3 rounded-lg border border-[#2a2e3b] bg-[#161a25] p-3">
            {needsAuth && (
              <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-amber-200 leading-snug">
                  Endpoint exige autenticação. Faça <strong>POST /login</strong> primeiro
                  para popular a sessão do testador.
                </p>
              </div>
            )}

            {endpoint.fields.length === 0 ? (
              <p className="text-[11.5px] text-[#8b8f9a] mb-3">Sem parâmetros — clique em <strong>Enviar</strong> para chamar o endpoint.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {endpoint.fields.map((field) => (
                  <FieldInput
                    key={field.name}
                    field={field}
                    value={formState[field.name] ?? ''}
                    onChange={(v) => setFormState((prev) => ({ ...prev, [field.name]: v }))}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={send}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play size={12} />
                {loading ? 'Enviando…' : 'Enviar'}
              </button>
              {response && (
                <span className="text-[11px] text-[#8b8f9a] ml-1">{response.timeMs} ms</span>
              )}
            </div>

            {/* Response */}
            {response && (
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={statusClass(response.status)}>
                    {response.status === 0 ? 'NETWORK' : `HTTP ${response.status}`}
                  </span>
                  {response.error && (
                    <span className="text-[11.5px] text-red-400">{response.error}</span>
                  )}
                </div>
                <pre className="overflow-auto max-h-72 rounded-lg bg-[#0d1117] border border-[#2a2e3b] px-3 py-2.5 text-[11.5px] text-[#cdd3df] font-mono leading-relaxed">
{response.body == null ? '(corpo vazio)' : typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Form field renderer ─────────────────────────────────────────────────────

function FieldInput({
  field, value, onChange,
}: {
  field:    Field
  value:    string
  onChange: (v: string) => void
}) {
  const label = (
    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#8b8f9a] mb-1">
      {field.label}
    </label>
  )
  const baseClass =
    'w-full rounded-lg bg-[#0d1117] border border-[#2a2e3b] px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500/60 font-mono'

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    )
  }
  if (field.type === 'textarea') {
    return (
      <div className="sm:col-span-2">
        {label}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className={`${baseClass} resize-y min-h-[68px] break-all`}
        />
      </div>
    )
  }
  return (
    <div>
      {label}
      <input
        type={field.type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={baseClass}
      />
    </div>
  )
}

// ── Bot session banner ──────────────────────────────────────────────────────

function SessionBanner({ session, onClear }: { session: BotSession | null; onClear: () => void }) {
  if (!session) {
    return (
      <div className="mb-4 rounded-xl border border-[#2a2e3b] bg-[#1d2130] p-3.5 flex items-center gap-3">
        <KeyRound size={16} className="text-[#8b8f9a] flex-shrink-0" />
        <div className="flex-1 text-[12.5px] text-[#bdc1cf]">
          Sessão do bot: <strong className="text-white">não autenticado</strong>.
          Use <strong className="text-emerald-400">POST /login</strong> para testar endpoints autenticados.
        </div>
      </div>
    )
  }
  // Spec: access token expires in 1h. Show countdown so the admin
  // knows when they need to refresh.
  const expiresAt = session.issued_at + 3600 * 1000
  const minutesLeft = Math.max(0, Math.round((expiresAt - Date.now()) / 60000))
  return (
    <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center gap-3">
      <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0" />
      <div className="flex-1 text-[12.5px] text-emerald-100 min-w-0">
        Autenticado como <strong className="text-white">{session.email || '—'}</strong>
        <span className="text-emerald-300/70 ml-2">· access expira em ~{minutesLeft} min</span>
        <div className="text-[10.5px] text-emerald-200/60 font-mono mt-0.5 truncate">
          Bearer {session.access_token.slice(0, 24)}…
        </div>
      </div>
      <button
        onClick={onClear}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0d1117]/40 hover:bg-[#0d1117]/60 border border-emerald-500/30 text-emerald-200 text-[11px] font-semibold transition-colors flex-shrink-0"
      >
        <LogOut size={11} />
        Limpar
      </button>
    </div>
  )
}

// ── Small presentational helpers ────────────────────────────────────────────

function methodClass(method: 'GET' | 'POST') {
  const base = 'text-[10px] font-bold tracking-wider rounded-md px-1.5 py-0.5'
  return method === 'POST'
    ? `${base} bg-blue-500/15 text-blue-300 border border-blue-500/30`
    : `${base} bg-emerald-500/15 text-emerald-300 border border-emerald-500/30`
}

function statusClass(status: number) {
  const base = 'text-[10px] font-bold tracking-wider rounded-md px-2 py-0.5 font-mono'
  if (status === 0)                  return `${base} bg-red-500/15 text-red-300 border border-red-500/30`
  if (status >= 200 && status < 300) return `${base} bg-emerald-500/15 text-emerald-300 border border-emerald-500/30`
  if (status >= 300 && status < 400) return `${base} bg-blue-500/15 text-blue-300 border border-blue-500/30`
  if (status >= 400 && status < 500) return `${base} bg-amber-500/15 text-amber-300 border border-amber-500/30`
  return `${base} bg-red-500/15 text-red-300 border border-red-500/30`
}

function Highlight({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[#2a2e3b] bg-[#1d2130] px-3.5 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[11px] font-bold tracking-wider text-white uppercase">{title}</span>
      </div>
      <p className="text-[12px] text-[#bdc1cf] leading-snug">{body}</p>
    </div>
  )
}
