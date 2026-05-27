'use client'

// Admin: Bot API overview page.
//
// Shows the base URL, the 8 endpoints with their auth requirements,
// copy-able curl snippets per endpoint, and a download button for the
// static PDF docs at /public/api-documentation.pdf.

import { useEffect, useMemo, useState } from 'react'
import {
  Plug, Download, Copy, Check, ShieldCheck, Globe, Clock, AlertTriangle,
} from 'lucide-react'

interface Endpoint {
  method:   'GET' | 'POST'
  path:     string
  summary:  string
  auth:     boolean
  curl:     string
}

function buildEndpoints(base: string): Endpoint[] {
  return [
    {
      method: 'POST', path: '/login', auth: false,
      summary: 'Autentica e retorna access_token (1h) + refresh_token (30d).',
      curl: `curl -X POST ${base}/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"usuario@email.com","password":"sua-senha"}'`,
    },
    {
      method: 'POST', path: '/refresh', auth: false,
      summary: 'Renova o access_token usando o refresh_token. Rotaciona o refresh.',
      curl: `curl -X POST ${base}/refresh \\
  -H "Content-Type: application/json" \\
  -d '{"refresh_token":"SEU_REFRESH_TOKEN"}'`,
    },
    {
      method: 'GET', path: '/profile', auth: true,
      summary: 'Dados completos do perfil + saldos (REAL e DEMO).',
      curl: `curl ${base}/profile \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
    },
    {
      method: 'GET', path: '/balance', auth: true,
      summary: 'Saldo da conta REAL + bônus + estado do rollover.',
      curl: `curl ${base}/balance \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
    },
    {
      method: 'GET', path: '/assets', auth: true,
      summary: 'Lista ativos disponíveis para trading (Binance, com payout do admin).',
      curl: `curl ${base}/assets \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
    },
    {
      method: 'POST', path: '/trade', auth: true,
      summary: 'Abre operação binária. Stake debita da conta REAL imediatamente.',
      curl: `curl -X POST ${base}/trade \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"BTCUSDT","direction":"up","stake":10,"duration_seconds":60}'`,
    },
    {
      method: 'GET', path: '/trades?status=open&limit=50&offset=0', auth: true,
      summary: 'Histórico de operações. status: open | closed | all.',
      curl: `curl "${base}/trades?status=open&limit=50&offset=0" \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
    },
    {
      method: 'GET', path: '/trade/:id', auth: true,
      summary: 'Detalhes de uma operação específica (sempre do usuário autenticado).',
      curl: `curl ${base}/trade/UUID_DA_OPERACAO \\
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"`,
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

export default function AdminApiPage() {
  // Base URL: inferred from the API origin (NEXT_PUBLIC_API_URL) so the
  // page always shows the URL bots will actually call. Falls back to a
  // localhost default that matches the dev setup.
  const [base, setBase] = useState('https://api.example.com/bot/v1')
  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    setBase(`${api.replace(/\/$/, '')}/bot/v1`)
  }, [])

  const endpoints = useMemo(() => buildEndpoints(base), [base])

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
      <div className="mb-6 rounded-xl border border-[#2a2e3b] bg-[#1d2130] p-4">
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

      {/* Auth + rate-limit highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Highlight icon={<ShieldCheck size={14} className="text-emerald-400" />} title="Autenticação" body="JWT no header Authorization: Bearer TOKEN. Access expira em 1h." />
        <Highlight icon={<Clock      size={14} className="text-blue-400" />}     title="Refresh"        body="Refresh token opaco (30d), rotacionado a cada uso. Revogue via DB se vazar." />
        <Highlight icon={<AlertTriangle size={14} className="text-amber-400" />} title="Rate limit"   body="5 tentativas de login / 5min por IP. Throttle de 1s entre operações." />
      </div>

      {/* Endpoints */}
      <div className="space-y-3 mb-8">
        <h2 className="text-base font-bold text-white mb-2">Endpoints</h2>
        {endpoints.map((ep, idx) => {
          const key = `ep-${idx}`
          return (
            <div key={key} className="rounded-xl border border-[#2a2e3b] bg-[#1d2130] overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3 border-b border-[#2a2e3b]">
                <span className={methodClass(ep.method)}>{ep.method}</span>
                <code className="text-sm font-mono text-white">{ep.path}</code>
                {ep.auth
                  ? <span className="ml-auto text-[10px] font-bold tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">AUTH</span>
                  : <span className="ml-auto text-[10px] font-bold tracking-wider text-[#8b8f9a] bg-[#252a3a] border border-[#2a2e3b] rounded-full px-2 py-0.5">PÚBLICO</span>
                }
              </div>
              <div className="px-4 py-3">
                <p className="text-[13px] text-[#bdc1cf] mb-3">{ep.summary}</p>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg bg-[#0d1117] border border-[#2a2e3b] px-3 py-2.5 text-[11.5px] text-[#cdd3df] font-mono leading-relaxed">
{ep.curl}
                  </pre>
                  <button
                    onClick={() => copy(ep.curl, key)}
                    className="absolute top-1.5 right-1.5 px-2 py-1 rounded-md bg-[#252a3a]/90 hover:bg-[#2d3344] text-white text-[10px] font-semibold flex items-center gap-1 transition-colors"
                  >
                    {copiedKey === key ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {copiedKey === key ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
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

// ── Small presentational helpers ────────────────────────────────────────────

function methodClass(method: 'GET' | 'POST') {
  const base = 'text-[10px] font-bold tracking-wider rounded-md px-1.5 py-0.5'
  return method === 'POST'
    ? `${base} bg-blue-500/15 text-blue-300 border border-blue-500/30`
    : `${base} bg-emerald-500/15 text-emerald-300 border border-emerald-500/30`
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
