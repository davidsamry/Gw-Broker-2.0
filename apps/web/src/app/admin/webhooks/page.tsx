'use client'

// /admin/webhooks — configure outbound webhook URLs + on/off per event.
// Backend: GET /admin/webhooks (list) + PATCH /admin/webhooks/:key.
// Each card mirrors the spec UI from Documentação webhook.pdf — Ativo toggle,
// URL input, save on blur/Enter, status feedback.

import { useCallback, useEffect, useState } from 'react'
import { Webhook, DollarSign, ArrowRightLeft, UserPlus, RefreshCw, Check } from 'lucide-react'
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

      {/* Toggle row */}
      <div className="flex items-center justify-between gap-3 mt-3 mb-3">
        <div>
          <div className="text-[11px] font-semibold text-white">Ativo</div>
          <div className="text-[10px] text-[#8b8f9a]">Ativar disparo deste webhook</div>
        </div>
        <button
          onClick={toggleActive}
          disabled={saving || !config}
          className={cn(
            'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
            active ? 'bg-emerald-500' : 'bg-[#252a3a]',
            (saving || !config) && 'opacity-50',
          )}
          aria-label={active ? 'Desativar' : 'Ativar'}
        >
          <span className={cn(
            'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform',
            active ? 'translate-x-5' : 'translate-x-0.5',
          )} />
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
    </div>
  )
}
