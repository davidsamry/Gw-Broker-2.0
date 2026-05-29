'use client'

// /admin/webhooks — configure outbound webhook URLs + on/off per event.
// Backend: GET /admin/webhooks (list) + PATCH /admin/webhooks/:key.
// Each card mirrors the spec UI from Documentação webhook.pdf — Ativo toggle,
// URL input, save on blur/Enter, status feedback.

import { useCallback, useEffect, useState } from 'react'
import { Webhook, DollarSign, ArrowRightLeft, UserPlus, RefreshCw, Check, Send, X as XIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type WebhookKey = 'REGISTRATION' | 'FIRST_DEPOSIT' | 'SUBSEQUENT_DEPOSIT'

interface WebhookConfig {
  id:        string
  key:       WebhookKey
  url:       string
  active:    boolean
  createdAt: string
  updatedAt: string
}

interface ListResponse {
  configs: WebhookConfig[]
}

// Per-key card metadata — keeps the UI declarative. Order matters: it's
// the visual order in the page. Matches the spec screenshot's layout
// (Primeiro Depósito, Subsequentes, Cadastro).
const CARDS: Array<{
  key:    WebhookKey
  title:  string
  desc:   string
  icon:   React.ReactNode
  accent: string
}> = [
  {
    key:    'FIRST_DEPOSIT',
    title:  'Primeiro Depósito',
    desc:   'Disparado quando um usuário realiza seu primeiro depósito',
    icon:   <DollarSign size={18} />,
    accent: 'text-emerald-400',
  },
  {
    key:    'SUBSEQUENT_DEPOSIT',
    title:  'Depósitos Subsequentes',
    desc:   'Disparado quando um usuário realiza depósitos após o primeiro',
    icon:   <ArrowRightLeft size={18} />,
    accent: 'text-blue-400',
  },
  {
    key:    'REGISTRATION',
    title:  'Cadastro',
    desc:   'Disparado quando um novo usuário se cadastra na plataforma',
    icon:   <UserPlus size={18} />,
    accent: 'text-purple-400',
  },
]

export default function AdminWebhooksPage() {
  const [configs, setConfigs] = useState<Record<WebhookKey, WebhookConfig> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api.get<ListResponse>('/admin/webhooks')
      const byKey = {} as Record<WebhookKey, WebhookConfig>
      for (const c of res.data.configs) byKey[c.key] = c
      setConfigs(byKey)
    } catch {
      setError('Erro ao carregar webhooks.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="px-6 py-6 max-w-[900px] mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Webhook size={20} className="text-emerald-400" />
            Webhooks
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">
            Configure webhooks para receber notificações de eventos
          </p>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#13161f] text-xs font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {CARDS.map((meta) => {
          const cfg = configs?.[meta.key] ?? null
          return (
            <WebhookCard
              key={meta.key}
              meta={meta}
              config={cfg}
              onSaved={(updated) => {
                setConfigs((prev) => prev ? { ...prev, [meta.key]: updated } : prev)
              }}
            />
          )
        })}
      </div>

      <p className="text-[11px] text-[#8b8f9a] mt-6 leading-relaxed">
        <strong className="text-white">Payload (depósitos):</strong>{' '}
        <code className="text-emerald-400">{'{ value, event_name, email }'}</code> ·{' '}
        <strong className="text-white">Cadastro:</strong>{' '}
        <code className="text-emerald-400">{'{ event_name, email }'}</code>.
        Retry automático: 3 tentativas com backoff exponencial (1s / 2s / 4s) · Timeout: 30s por tentativa.
      </p>
    </div>
  )
}

// ── Per-event card ──────────────────────────────────────────────────────────

function WebhookCard({
  meta, config, onSaved,
}: {
  meta:   { key: WebhookKey; title: string; desc: string; icon: React.ReactNode; accent: string }
  config: WebhookConfig | null
  onSaved: (cfg: WebhookConfig) => void
}) {
  const [url, setUrl]       = useState(config?.url ?? '')
  const [active, setActive] = useState(config?.active ?? false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr]       = useState('')
  // Test-send state — independent of save state so a save in flight
  // doesn't block clicking Test, and vice versa.
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok:         boolean
    status?:    number
    durationMs: number
    message?:   string
  } | null>(null)

  // Sync local state when the parent re-hydrates the config (e.g. after
  // a manual refresh). Don't fight the user: only sync if they haven't
  // started typing (local url matches the last known config url).
  useEffect(() => {
    if (config) {
      setUrl(config.url)
      setActive(config.active)
    }
  }, [config?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch: { url?: string; active?: boolean }) {
    setSaving(true); setErr('')
    try {
      const res = await api.patch<{ config: WebhookConfig }>(`/admin/webhooks/${meta.key}`, patch)
      onSaved(res.data.config)
      setSavedAt(Date.now())
      // Auto-clear the "saved!" hint after 2s so it doesn't linger.
      setTimeout(() => setSavedAt((t) => (t && Date.now() - t >= 2000 ? null : t)), 2100)
    } catch (e: any) {
      const code = e?.response?.data?.error
      if      (code === 'INVALID_URL') setErr('URL inválida — use http:// ou https://')
      else if (code === 'NOT_FOUND')   setErr('Configuração não encontrada.')
      else                              setErr('Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  // Toggle commits immediately. URL field commits on blur OR Enter so the
  // user doesn't have to find a "save" button — same UX as Quotex's
  // affiliate panel.
  function toggleActive() {
    const next = !active
    setActive(next)
    save({ active: next })
  }

  function commitUrl() {
    const trimmed = url.trim()
    if (trimmed === (config?.url ?? '')) return   // no change
    save({ url: trimmed })
  }

  // Send a test payload to the configured URL. Backend returns the live
  // result (status + duration) so we surface it inline — no inbox / log
  // tailing required to confirm reachability.
  async function sendTest() {
    if (testing || !config) return
    if (!url.trim()) { setErr('Salve uma URL antes de testar.'); return }
    setTesting(true); setErr(''); setTestResult(null)
    try {
      const res = await api.post(`/admin/webhooks/${meta.key}/test`)
      const data = res.data as { ok: boolean; status?: number; durationMs: number }
      setTestResult({ ok: data.ok, status: data.status, durationMs: data.durationMs })
    } catch (e: any) {
      const body = e?.response?.data ?? {}
      setTestResult({
        ok:         false,
        status:     body.status,
        durationMs: body.durationMs ?? 0,
        message:    body.message ?? body.error ?? 'Erro desconhecido',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-2.5">
          <span className={cn('mt-0.5', meta.accent)}>{meta.icon}</span>
          <div>
            <h2 className="text-sm font-bold text-white">{meta.title}</h2>
            <p className="text-[11px] text-[#8b8f9a] mt-0.5">{meta.desc}</p>
          </div>
        </div>
      </div>

      {/* Toggle row — track + thumb sized with inline style so a flex
          parent can't squash it. Tailwind's `w-11 h-6` was being
          shrunk to 35×19 in practice (sub-pixel rounding from the
          flex-shrink chain), pushing the thumb visually outside. */}
      <div className="flex items-center justify-between gap-3 mt-3 mb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-white">Ativo</div>
          <div className="text-[10px] text-[#8b8f9a]">Ativar disparo deste webhook</div>
        </div>
        <button
          onClick={toggleActive}
          disabled={saving || !config}
          style={{ width: 44, height: 24 }}
          className={cn(
            'relative rounded-full transition-colors flex-shrink-0',
            active ? 'bg-emerald-500' : 'bg-[#252a3a]',
            (saving || !config) && 'opacity-50 cursor-not-allowed',
          )}
          aria-label={active ? 'Desativar' : 'Ativar'}
        >
          <span
            style={{
              width:     20,
              height:    20,
              top:       2,
              left:      2,
              transform: `translateX(${active ? 20 : 0}px)`,
              transition: 'transform 200ms',
            }}
            className="absolute rounded-full bg-white shadow"
          />
        </button>
      </div>

      {/* URL row */}
      <div>
        <label className="text-[10px] font-semibold text-[#8b8f9a] uppercase tracking-wide mb-1.5 block">
          URL do Webhook
        </label>
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={commitUrl}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            placeholder="https://exemplo.com/webhook"
            disabled={saving || !config}
            className="flex-1 h-9 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 text-xs text-white placeholder-[#3a3f50] outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          {savedAt && Date.now() - savedAt < 2000 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-[10px] font-bold text-emerald-300">
              <Check size={11} /> Salvo
            </span>
          )}
        </div>
        {err && <p className="text-[11px] text-red-400 mt-1.5">{err}</p>}
      </div>

      {/* Test row — sends a sample payload (one shot, no retry) and
          surfaces the live response status + duration so the admin can
          verify the receiver is reachable without registering a fake
          user or making a real deposit. Fires regardless of `active`
          (toggle is the production gate, not a global block). */}
      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-[#1f232e]">
        <div className="flex-1 min-w-0">
          {testResult ? (
            <div className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border',
              testResult.ok
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-red-500/15 border-red-500/40 text-red-300',
            )}>
              {testResult.ok ? <Check size={11} /> : <XIcon size={11} />}
              {testResult.ok
                ? `Sucesso · HTTP ${testResult.status} · ${testResult.durationMs}ms`
                : `Falhou${testResult.status ? ` · HTTP ${testResult.status}` : ''}${testResult.durationMs ? ` · ${testResult.durationMs}ms` : ''}${testResult.message ? ` · ${testResult.message}` : ''}`}
            </div>
          ) : (
            <span className="text-[10px] text-[#8b8f9a]">
              Envia um payload de exemplo para verificar a URL
            </span>
          )}
        </div>
        <button
          onClick={sendTest}
          disabled={testing || saving || !config || !url.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1f232e] bg-[#1a1e2a] text-[11px] font-semibold text-white hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Send size={11} />
          {testing ? 'Enviando…' : 'Enviar teste'}
        </button>
      </div>
    </div>
  )
}
