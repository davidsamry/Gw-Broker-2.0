'use client'

import { useRef, useState } from 'react'
import { X, Upload, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth'

interface Props {
  onClose: () => void
  onDone:  () => void
}

interface FileSlot {
  key:        'documentFrontUrl' | 'documentBackUrl' | 'selfieUrl'
  label:      string
  shortLabel: string  // used on mobile / inside the small picker
  hint:       string
}

const SLOTS: FileSlot[] = [
  { key: 'documentFrontUrl', label: 'Documento (Frente)',   shortLabel: 'Frente', hint: 'RG / CNH / Passaporte' },
  { key: 'documentBackUrl',  label: 'Documento (Verso)',    shortLabel: 'Verso',  hint: 'Mesmo documento' },
  { key: 'selfieUrl',        label: 'Selfie com Documento', shortLabel: 'Selfie', hint: 'Segurando o doc' },
]

const MAX_BYTES = 3 * 1024 * 1024  // 3MB per file
const ACCEPT    = 'image/jpeg,image/png,image/webp'

// Modal for the user to upload their 3 KYC documents. Files are read as
// base64 data URLs client-side and POSTed to /auth/kyc/submit. This avoids
// needing a separate file storage backend for the MVP.

export function KycUploadModal({ onClose, onDone }: Props) {
  const [files, setFiles] = useState<Record<FileSlot['key'], string | null>>({
    documentFrontUrl: null,
    documentBackUrl:  null,
    selfieUrl:        null,
  })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const allReady = SLOTS.every((s) => files[s.key])

  async function handleFile(slot: FileSlot['key'], file: File) {
    setError('')
    if (!ACCEPT.split(',').includes(file.type)) {
      setError(`Arquivo "${file.name}": apenas JPEG, PNG ou WEBP.`)
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`Arquivo "${file.name}": tamanho máximo 3MB (atual: ${(file.size / 1024 / 1024).toFixed(1)}MB).`)
      return
    }
    const dataUrl = await readAsDataUrl(file)
    setFiles((prev) => ({ ...prev, [slot]: dataUrl }))
  }

  async function submit() {
    if (!allReady || loading) return
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/kyc/submit', files)
      if (data?.submission) {
        useAuthStore.setState({ kycSubmission: data.submission })
        // Also bump the user.kycStatus locally for instant UI update
        const u = useAuthStore.getState().user
        if (u) useAuthStore.setState({ user: { ...u, kycStatus: 'SUBMITTED' } })
      }
      setSubmitted(true)
      // Stays open until the user closes (X / Cancelar / Fechar) so the
      // success message doesn't disappear before they can read it.
    } catch (err: any) {
      const code   = err?.response?.data?.error
      const status = err?.response?.status
      // Map common failure modes to actionable messages.
      if (code === 'VALIDATION_ERROR') {
        setError('Algum arquivo é inválido: verifique formato (JPG/PNG/WEBP) e tamanho (até 3MB cada).')
      } else if (status === 413) {
        setError('Imagens muito grandes. Reduza a qualidade ou tamanho (até 3MB cada).')
      } else if (status === 401) {
        setError('Sessão expirou. Faça login novamente.')
      } else if (!err?.response) {
        setError('Sem conexão com o servidor. Verifique sua internet.')
      } else {
        setError(`Erro ao enviar (HTTP ${status ?? '???'}). Tente novamente em instantes.`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-[560px] bg-[#1a1e2e] border border-[#2a2e3b] rounded-2xl shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b] flex-shrink-0">
          <h2 className="text-sm font-bold text-white">Enviar documentos</h2>
          <button onClick={onClose} className="text-[#8b8f9a] hover:text-white"><X size={18} /></button>
        </div>

        {submitted ? (
          // ── Success view ─────────────────────────────────────────────────
          <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/40 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-green-400" />
            </div>
            <h3 className="text-base font-bold text-white">Enviado com sucesso!</h3>
            <p className="text-xs text-[#ccc] leading-relaxed max-w-xs">
              Seus documentos estão na fila de análise. Você receberá uma resposta
              em até <strong>48 horas</strong>.
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-blue-400 mt-1">
              <Clock size={12} />
              Status atual: <span className="font-bold">Em análise</span>
            </div>
            <button
              onClick={onDone}
              className="mt-3 px-5 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto px-4 sm:px-5 py-4 sm:py-5 flex flex-col gap-4">
              <p className="text-xs text-[#ccc] leading-relaxed">
                Envie 3 imagens claras e legíveis. Análise em até 48 horas.
                JPG/PNG/WEBP, até 3MB por foto.
              </p>

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {SLOTS.map((slot) => (
                  <FilePicker
                    key={slot.key}
                    slot={slot}
                    dataUrl={files[slot.key]}
                    onPick={(f) => handleFile(slot.key, f)}
                    onClear={() => setFiles((prev) => ({ ...prev, [slot.key]: null }))}
                  />
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                  <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-red-400">{error}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-5 py-4 border-t border-[#2a2e3b] flex-shrink-0">
              <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-[#2a2e3b] text-xs font-semibold text-[#8b8f9a] hover:text-white">
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={!allReady || loading}
                className="flex-1 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Upload size={13} />
                {loading ? 'Enviando…' : 'Enviar para análise'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FilePicker({
  slot, dataUrl, onPick, onClear,
}: {
  slot:    FileSlot
  dataUrl: string | null
  onPick:  (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const has      = !!dataUrl

  return (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center gap-1 mb-1.5 min-h-[28px]">
        <div className="min-w-0 flex-1">
          {/* Long label on sm+; short label on mobile to keep the column tight */}
          <div className="text-[11px] sm:text-xs font-bold text-white truncate">
            <span className="hidden sm:inline">{slot.label}</span>
            <span className="sm:hidden">{slot.shortLabel}</span>
          </div>
          <div className="text-[9px] sm:text-[10px] text-[#8b8f9a] truncate">{slot.hint}</div>
        </div>
        {has && <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''  // allow re-picking the same file
        }}
      />

      {has ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl!}
            alt={slot.label}
            className="w-full aspect-square object-cover rounded-lg border border-[#2a2e3b]"
          />
          {/* Overlay actions — visible on hover desktop, always on mobile */}
          <div className="absolute inset-x-1 bottom-1 flex gap-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex-1 py-1 rounded bg-black/75 text-[9px] sm:text-[10px] font-semibold text-white border border-white/20 hover:bg-black/90"
            >
              Trocar
            </button>
            <button
              type="button"
              onClick={onClear}
              className="flex-1 py-1 rounded bg-red-500/90 text-[9px] sm:text-[10px] font-semibold text-white hover:bg-red-500"
            >
              Remover
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'w-full aspect-square rounded-lg border-2 border-dashed border-[#2a2e3b]',
            'flex flex-col items-center justify-center gap-1 px-1',
            'text-[#8b8f9a] hover:border-blue-500/60 hover:text-white transition-colors'
          )}
        >
          <Upload size={18} className="sm:hidden" />
          <Upload size={22} className="hidden sm:block" />
          <span className="text-[10px] sm:text-xs font-semibold">Selecionar</span>
          <span className="hidden sm:block text-[10px] text-center leading-tight">JPG/PNG/WEBP<br/>até 3MB</span>
        </button>
      )}
    </div>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
