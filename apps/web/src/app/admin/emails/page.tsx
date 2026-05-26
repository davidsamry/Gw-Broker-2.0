'use client'

// Email templates admin page — list / preview / edit / test.
//
// Pattern mirrors /admin/otc and /admin/bonus: a grid of cards with
// inline status badges + action buttons. Edit and preview live in
// modals so the page itself stays a single scrollable list. No URL
// routing per template — keeps the back-button behaviour simple.

import { useCallback, useEffect, useState } from 'react'
import { Mail, RefreshCw, Pencil, Send, Eye, Check, X, AlertCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface EmailTemplate {
  key:         string
  name:        string
  description: string
  subject:     string
  htmlBody:    string
  variables:   string[]
  active:      boolean
  updatedAt:   string
}

interface ListResponse    { templates: EmailTemplate[] }
interface SingleResponse  { template:  EmailTemplate }

export default function AdminEmailsPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [editing,   setEditing]   = useState<EmailTemplate | null>(null)
  const [previewing, setPreviewing] = useState<EmailTemplate | null>(null)
  const [testingKey, setTestingKey] = useState<string | null>(null)
  const [flash,      setFlash]      = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data } = await api.get<ListResponse>('/admin/emails/templates')
      setTemplates(data.templates)
    } catch {
      setError('Falha ao carregar templates.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function sendTest(key: string) {
    setTestingKey(key); setFlash(null)
    try {
      const { data } = await api.post<{ ok: boolean; sentTo: string }>(`/admin/emails/templates/${key}/test`)
      setFlash({ type: 'ok', msg: `Email enviado para ${data.sentTo}` })
      setTimeout(() => setFlash(null), 6000)
    } catch (err: any) {
      const code = err?.response?.data?.error ?? 'SEND_FAILED'
      setFlash({ type: 'err', msg: `Falha ao enviar: ${code}` })
      setTimeout(() => setFlash(null), 6000)
    } finally {
      setTestingKey(null)
    }
  }

  async function saveTemplate(updated: { subject: string; htmlBody: string; active: boolean }) {
    if (!editing) return
    try {
      const { data } = await api.patch<SingleResponse>(`/admin/emails/templates/${editing.key}`, updated)
      setTemplates(prev => prev.map(t => t.key === editing.key ? data.template : t))
      setEditing(null)
      setFlash({ type: 'ok', msg: 'Template salvo.' })
      setTimeout(() => setFlash(null), 4000)
    } catch {
      setFlash({ type: 'err', msg: 'Erro ao salvar.' })
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <Mail size={20} className="text-blue-400" />
            Configurações de Email
          </h1>
          <p className="text-xs md:text-sm text-[#8b8f9a] mt-1">
            Personalize os templates de email enviados aos usuários
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1f2e] border border-[#2a2e3b] text-sm text-white hover:border-blue-500/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* Variables hint */}
      <div className="mb-4 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-300 flex items-start gap-3">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Variáveis disponíveis</p>
          <p className="text-xs text-blue-200/80">
            Use variáveis como <code className="px-1.5 py-0.5 rounded bg-blue-500/20 font-mono">{'{{name}}'}</code> no conteúdo dos emails.
            Serão substituídas automaticamente pelos dados do usuário.
          </p>
        </div>
      </div>

      {/* Flash messages */}
      {flash && (
        <div className={cn(
          'mb-4 px-4 py-3 rounded-lg border text-sm flex items-center gap-2',
          flash.type === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400',
        )}>
          {flash.type === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
          {flash.msg}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Grid */}
      {loading && templates.length === 0 ? (
        <div className="text-center py-16 text-[#8b8f9a] text-sm">Carregando…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-[#8b8f9a] text-sm">Nenhum template cadastrado.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map(tpl => (
            <TemplateCard
              key={tpl.key}
              template={tpl}
              onPreview={() => setPreviewing(tpl)}
              onTest={() => sendTest(tpl.key)}
              onEdit={() => setEditing(tpl)}
              testing={testingKey === tpl.key}
            />
          ))}
        </div>
      )}

      {editing    && <EditModal    template={editing}    onClose={() => setEditing(null)}    onSave={saveTemplate} />}
      {previewing && <PreviewModal template={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}

// ── Template card ─────────────────────────────────────────────────────────
function TemplateCard({
  template, onPreview, onTest, onEdit, testing,
}: {
  template: EmailTemplate
  onPreview: () => void
  onTest:    () => void
  onEdit:    () => void
  testing:   boolean
}) {
  return (
    <div className="rounded-xl bg-[#1a1f2e] border border-[#2a2e3b] p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Mail size={14} className="text-[#8b8f9a] flex-shrink-0" />
          <h3 className="text-white font-semibold text-sm truncate">{template.name}</h3>
        </div>
        <span className={cn(
          'text-[10px] font-bold px-2 py-0.5 rounded-full border',
          template.active
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            : 'bg-[#2a2e3b] text-[#8b8f9a] border-[#2a2e3b]',
        )}>
          {template.active ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <p className="text-xs text-[#8b8f9a] mb-3">{template.description}</p>

      <div className="mb-3">
        <div className="text-[10px] text-[#7c8195] uppercase tracking-wider font-semibold mb-1">Assunto</div>
        <div className="text-sm text-white font-medium truncate">{template.subject}</div>
      </div>

      {template.variables.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] text-[#7c8195] uppercase tracking-wider font-semibold mb-1">Variáveis</div>
          <div className="flex flex-wrap gap-1.5">
            {template.variables.map(v => (
              <code key={v} className="text-[10px] font-mono bg-[#222637] border border-[#2a2e3b] rounded px-1.5 py-0.5 text-blue-300">
                {`{{${v}}}`}
              </code>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onPreview}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#222637] border border-[#2a2e3b] text-xs text-[#bdc1cf] hover:text-white hover:border-[#3a4055] transition-colors"
        >
          <Eye size={12} /> Visualizar
        </button>
        <button
          onClick={onTest}
          disabled={!template.active || testing}
          title={!template.active ? 'Ative o template para enviar testes' : ''}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#222637] border border-[#2a2e3b] text-xs text-[#bdc1cf] hover:text-white hover:border-[#3a4055] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Testar
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 transition-colors ml-auto"
        >
          <Pencil size={12} /> Editar
        </button>
      </div>
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────
function EditModal({
  template, onClose, onSave,
}: {
  template: EmailTemplate
  onClose:  () => void
  onSave:   (data: { subject: string; htmlBody: string; active: boolean }) => Promise<void>
}) {
  const [subject,  setSubject]  = useState(template.subject)
  const [htmlBody, setHtmlBody] = useState(template.htmlBody)
  const [active,   setActive]   = useState(template.active)
  const [saving,   setSaving]   = useState(false)

  async function handleSave() {
    setSaving(true)
    try { await onSave({ subject, htmlBody, active }) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl bg-[#1a1f2e] border border-[#2a2e3b] rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#2a2e3b] flex-shrink-0">
          <div>
            <h2 className="text-white font-bold">Editar Template: {template.name}</h2>
            <p className="text-xs text-[#8b8f9a] mt-0.5">{template.description}</p>
          </div>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          {/* Active toggle */}
          <label className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#222637] border border-[#2a2e3b] cursor-pointer">
            <div>
              <div className="text-sm font-semibold text-white">Template ativo</div>
              <div className="text-xs text-[#8b8f9a] mt-0.5">Desative para parar o envio sem perder o conteúdo.</div>
            </div>
            <div className="relative inline-block w-11 h-6 flex-shrink-0">
              <input type="checkbox" className="sr-only peer" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <div className="absolute inset-0 rounded-full bg-[#2a2e3b] peer-checked:bg-emerald-500 transition-colors" />
              <div className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform', active && 'translate-x-5')} />
            </div>
          </label>

          {/* Subject */}
          <div>
            <label className="block text-sm font-semibold text-white mb-1.5">Assunto do Email</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-[#222637] border border-[#2a2e3b] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors"
            />
          </div>

          {/* HTML body */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-semibold text-white">Conteúdo (HTML)</label>
              {template.variables.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {template.variables.map(v => (
                    <code key={v} className="text-[10px] font-mono bg-blue-500/15 border border-blue-500/30 rounded px-1.5 py-0.5 text-blue-300">
                      {`{{${v}}}`}
                    </code>
                  ))}
                </div>
              )}
            </div>
            <textarea
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full bg-[#0f1320] border border-[#2a2e3b] rounded-lg px-3 py-2.5 text-xs text-[#e5e7eb] outline-none focus:border-blue-500/60 transition-colors font-mono leading-relaxed resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-[#2a2e3b] flex-shrink-0">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-[#2a2e3b] text-sm text-[#bdc1cf] hover:text-white transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Preview modal ─────────────────────────────────────────────────────────
function PreviewModal({
  template, onClose,
}: {
  template: EmailTemplate
  onClose:  () => void
}) {
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api.get<{ subject: string; html: string }>(`/admin/emails/templates/${template.key}/preview`)
      .then(({ data }) => setPreview(data))
      .catch(() => setPreview({ subject: '(erro)', html: '<p style="color:#ef4444">Falha ao renderizar preview.</p>' }))
      .finally(() => setLoading(false))
  }, [template.key])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl bg-[#1a1f2e] border border-[#2a2e3b] rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-[#2a2e3b] flex-shrink-0">
          <div>
            <h2 className="text-white font-bold">Preview: {template.name}</h2>
            {preview && <p className="text-xs text-[#8b8f9a] mt-0.5">Assunto: <span className="text-white">{preview.subject}</span></p>}
          </div>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-12 text-[#8b8f9a]">Renderizando…</div>
          ) : preview ? (
            <iframe
              srcDoc={preview.html}
              sandbox=""
              className="w-full min-h-[500px] rounded-lg bg-white"
              title={`Preview ${template.name}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
