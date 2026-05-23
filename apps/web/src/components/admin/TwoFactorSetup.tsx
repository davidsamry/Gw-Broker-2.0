'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, Copy, Check } from 'lucide-react'
import { api } from '@/lib/api'

interface SetupResponse {
  secret:     string
  otpauthUrl: string
  qrDataUrl:  string  // base64 PNG data URI for <img>
}

interface Props {
  onEnabled: () => void   // called after the user confirms a valid code
  onCancel?: () => void
  /** Show "skip" button (useful for opt-in flows, not for mandatory admin). */
  cancellable?: boolean
}

// 3-step component: (1) fetch setup material from server, (2) display QR +
// manual secret, (3) verify a code to enable. Reusable for both the admin
// mandatory-setup page and the Minha Conta opt-in toggle.
export function TwoFactorSetup({ onEnabled, onCancel, cancellable = true }: Props) {
  const [setup, setSetup]     = useState<SetupResponse | null>(null)
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    setLoading(true)
    api.post<SetupResponse>('/auth/2fa/setup')
      .then((res) => setSetup(res.data))
      .catch(() => setError('Não foi possível iniciar o setup. Tente novamente.'))
      .finally(() => setLoading(false))
  }, [])

  async function copySecret() {
    if (!setup) return
    try {
      await navigator.clipboard.writeText(setup.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — ignore */ }
  }

  async function enable() {
    if (code.length !== 6) return
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/2fa/enable', { code })
      onEnabled()
    } catch (err: any) {
      const errCode = err?.response?.data?.error
      if (errCode === 'INVALID_2FA_CODE') setError('Código inválido. Tente novamente.')
      else                                setError('Erro ao ativar 2FA.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  if (!setup && loading) {
    return (
      <div className="py-10 text-center text-sm text-[#8b8f9a]">Carregando…</div>
    )
  }
  if (!setup) {
    return (
      <div className="py-10 text-center text-sm text-red-400">{error || 'Erro.'}</div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-500/30 rounded-lg px-3 py-3">
        <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-[#ccc] leading-relaxed">
          Use um aplicativo autenticador (Google Authenticator, Authy, 1Password)
          para escanear o QR ou colar o segredo. Depois digite o código para confirmar.
        </p>
      </div>

      {/* QR code */}
      <div className="flex justify-center">
        <div className="p-3 bg-white rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUrl} alt="QR Code 2FA" width={200} height={200} />
        </div>
      </div>

      {/* Manual secret */}
      <div>
        <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">
          Ou cole este segredo manualmente:
        </label>
        <div className="flex items-center gap-2 bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-2">
          <code className="flex-1 text-xs text-white font-mono break-all">{setup.secret}</code>
          <button
            type="button"
            onClick={copySecret}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          >
            {copied ? <><Check size={11} /> Copiado</> : <><Copy size={11} /> Copiar</>}
          </button>
        </div>
      </div>

      {/* Verify code */}
      <div>
        <label className="text-[10px] font-medium text-[#8b8f9a] mb-1 block">
          Código de 6 dígitos do app:
        </label>
        <input
          autoFocus
          inputMode="numeric"
          pattern="\d{6}"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="w-full bg-[#1a1e2a] border border-[#1f232e] rounded-lg px-3 py-3 text-center text-xl font-mono text-white outline-none focus:border-emerald-500/60 tracking-[0.5em]"
        />
      </div>

      {error && (
        <p className="text-xs text-red-400 text-center">{error}</p>
      )}

      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={enable}
          disabled={loading || code.length !== 6}
          className="w-full h-10 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-sm font-bold text-black transition-colors disabled:opacity-50"
        >
          {loading ? 'Verificando…' : 'Ativar 2FA'}
        </button>
        {cancellable && onCancel && (
          <button
            onClick={onCancel}
            className="w-full h-10 rounded-lg border border-[#1f232e] text-sm font-semibold text-[#8b8f9a] hover:text-white hover:bg-white/5 transition-colors"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}
