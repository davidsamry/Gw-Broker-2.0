'use client'

// /admin/meta-pixel — Meta Conversions API integration config.
//
// Single-form page (no list/CRUD): admin types Pixel ID + Token + optional
// test code, toggles enabled, hits Salvar. GET returns a masked token
// (tokenPreview + hasToken) so the secret never round-trips; PATCH accepts
// the full token when the admin retypes it. Leaving the token field blank
// means "keep current" — that branch sends the field as undefined.

import { useCallback, useEffect, useState } from 'react'
import {
  Activity, RefreshCw, Check, X as XIcon, Eye, EyeOff, AlertCircle, Save,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface MetaPixelResponse {
  enabled:       boolean
  pixelId:       string
  hasToken:      boolean
  tokenPreview:  string
  testEventCode: string
  updatedAt:     string
}

export default function AdminMetaPixelPage() {
  const [server, setServer]   = useState<MetaPixelResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [toast, setToast]     = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  // Form state mirrors the API contract. pixelToken is "" by default;
  // user must explicitly retype to replace. We never auto-fill it from
  // the server response (the token is masked there for security).
  const [enabled, setEnabled]             = useState(false)
  const [pixelId, setPixelId]             = useState('')
  const [pixelToken, setPixelToken]       = useState('')
  const [showToken, setShowToken]         = useState(false)
  const [testEventCode, setTestEventCode] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api.get<MetaPixelResponse>('/admin/meta-pixel')
      setServer(res.data)
      setEnabled(res.data.enabled)
      setPixelId(res.data.pixelId)
      setTestEventCode(res.data.testEventCode)
      // Don't touch the input — admin retypes only if they want to change.
      setPixelToken('')
    } catch {
      setError('Erro ao carregar configurações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-clear toast after 3s.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function save() {
    if (saving) return
    setSaving(true); setError('')
    try {
      // Client-side validation matching the backend rules — friendlier
      // errors than waiting for 400 to bounce.
      if (enabled && !pixelId.trim()) {
        setSaving(false)
        setToast({ kind: 'err', msg: 'Pixel ID é obrigatório quando integração está ativa.' })
        return
      }
      if (enabled && !server?.hasToken && !pixelToken.trim()) {
        setSaving(false)
        setToast({ kind: 'err', msg: 'Pixel Token é obrigatório quando integração está ativa.' })
        return
      }
      if (pixelId.trim() && !/^\d+$/.test(pixelId.trim())) {
        setSaving(false)
        setToast({ kind: 'err', msg: 'Pixel ID deve conter apenas dígitos.' })
        return
      }

      // Build PATCH body — only send pixelToken if admin actually typed
      // something. Sending "" would CLEAR the existing token; sending
      // undefined keeps it. This is the "leave existing token untouched"
      // affordance the requirements call out.
      const body: Record<string, unknown> = {
        enabled,
        pixelId:       pixelId.trim(),
        testEventCode: testEventCode.trim(),
      }
      if (pixelToken.trim() !== '') body.pixelToken = pixelToken.trim()

      const res = await api.patch<MetaPixelResponse>('/admin/meta-pixel', body)
      setServer(res.data)
      setPixelId(res.data.pixelId)
      setTestEventCode(res.data.testEventCode)
      setPixelToken('')   // clear input so admin sees "blank = keep current"
      setToast({ kind: 'ok', msg: 'Configurações salvas com sucesso.' })
    } catch (e: any) {
      const code = e?.response?.data?.error
      if      (code === 'PIXEL_ID_REQUIRED')    setToast({ kind: 'err', msg: 'Pixel ID obrigatório quando ativo.' })
      else if (code === 'PIXEL_TOKEN_REQUIRED') setToast({ kind: 'err', msg: 'Token obrigatório quando ativo.' })
      else                                       setToast({ kind: 'err', msg: 'Erro ao salvar configurações.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-6 py-6 max-w-[760px] mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-emerald-400" />
            Meta Pixel
          </h1>
          <p className="text-xs text-[#8b8f9a] mt-0.5">
            Configure a Meta Conversions API para rastreamento de cadastro e depósito
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

      <div className="bg-[#13161f] border border-[#1f232e] rounded-xl p-5 flex flex-col gap-5">
        {/* Enabled toggle row */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">Ativo</div>
            <div className="text-[11px] text-[#8b8f9a]">Ativar rastreamento do Meta Pixel (Conversions API)</div>
          </div>
          <button
            onClick={() => setEnabled((v) => !v)}
            disabled={saving || loading}
            style={{ width: 44, height: 24 }}
            className={cn(
              'relative rounded-full transition-colors flex-shrink-0',
              enabled ? 'bg-emerald-500' : 'bg-[#252a3a]',
              (saving || loading) && 'opacity-50 cursor-not-allowed',
            )}
            aria-label={enabled ? 'Desativar' : 'Ativar'}
          >
            <span
              style={{
                width: 20, height: 20, top: 2, left: 2,
                transform: `translateX(${enabled ? 20 : 0}px)`,
                transition: 'transform 200ms',
              }}
              className="absolute rounded-full bg-white shadow"
            />
          </button>
        </div>

        <hr className="border-[#1f232e]" />

        {/* Pixel ID */}
        <div>
          <label className="text-[11px] font-semibold text-white uppercase tracking-wide mb-1.5 block">
            Meta Pixel ID
          </label>
          <input
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="Ex: 1660498221521632"
            disabled={saving || loading}
            inputMode="numeric"
            className="w-full h-10 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 text-sm text-white placeholder-[#3a3f50] outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <p className="text-[10px] text-[#8b8f9a] mt-1.5">Apenas dígitos. Encontre no Gerenciador de Eventos da Meta.</p>
        </div>

        {/* Pixel Token */}
        <div>
          <label className="text-[11px] font-semibold text-white uppercase tracking-wide mb-1.5 block">
            Meta Pixel Token
          </label>
          <div className="relative">
            <input
              value={pixelToken}
              onChange={(e) => setPixelToken(e.target.value)}
              placeholder={server?.hasToken ? `(token salvo: ${server.tokenPreview} — deixe vazio para manter)` : 'Ex: EAA...'}
              disabled={saving || loading}
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              className="w-full h-10 bg-[#1a1e2a] border border-[#1f232e] rounded-lg pl-3 pr-10 text-sm text-white placeholder-[#3a3f50] outline-none focus:border-emerald-500/50 disabled:opacity-50 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors"
              aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[10px] text-[#8b8f9a] mt-1.5">
            Token de acesso da Conversions API. {server?.hasToken
              ? 'Já configurado. Deixe vazio para manter, ou cole novo para substituir.'
              : 'Ainda não configurado.'}
          </p>
        </div>

        {/* Test event code */}
        <div>
          <label className="text-[11px] font-semibold text-white uppercase tracking-wide mb-1.5 block">
            Código de Teste da Meta <span className="text-[#8b8f9a] normal-case font-normal">(opcional)</span>
          </label>
          <input
            value={testEventCode}
            onChange={(e) => setTestEventCode(e.target.value)}
            placeholder="TEST123..."
            disabled={saving || loading}
            className="w-full h-10 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 text-sm text-white placeholder-[#3a3f50] outline-none focus:border-emerald-500/50 disabled:opacity-50 font-mono"
          />
          <p className="text-[10px] text-[#8b8f9a] mt-1.5">
            Encaminha eventos para a aba "Test Events" do Gerenciador. Limpe o campo para enviar em produção.
          </p>
        </div>

        {enabled && (
          <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200 leading-relaxed">
              Integração ativa. Todo novo cadastro envia <code className="text-amber-100">CompleteRegistration</code>;
              todo depósito confirmado envia <code className="text-amber-100">Purchase</code>.
              Verifique o resultado em "Test Events" antes de remover o código de teste.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-[#1f232e]">
          <div className="text-[10px] text-[#8b8f9a]">
            {server?.updatedAt && <>Última atualização: {new Date(server.updatedAt).toLocaleString('pt-BR')}</>}
          </div>
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={13} />
            {saving ? 'Salvando…' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      {/* Floating toast */}
      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 z-50 border',
          toast.kind === 'ok'
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            : 'bg-red-500/15 border-red-500/40 text-red-300',
        )}>
          {toast.kind === 'ok' ? <Check size={14} /> : <XIcon size={14} />}
          <span className="text-xs font-semibold">{toast.msg}</span>
        </div>
      )}
    </div>
  )
}
