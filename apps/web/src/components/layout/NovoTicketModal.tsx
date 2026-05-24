'use client'

import { useState, type FormEvent } from 'react'
import { X, Paperclip, ImageOff, Send, Loader2, MessageSquare } from 'lucide-react'
import { api } from '@/lib/api'
import type { ApiTicket } from '@/store/tickets'

interface Props {
  onClose:   () => void
  onCreated: (t: ApiTicket) => void
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const MAX_BYTES = 5 * 1024 * 1024 // 5MB

// Full-screen modal for creating a new ticket. Matches the existing modal
// pattern (KycUploadModal / NovaRetiradaModal): dark overlay + centered card.

export function NovoTicketModal({ onClose, onCreated }: Props) {
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [attachment, setAttachment] = useState<string | null>(null)
  const [error, setError]     = useState('')
  const [sending, setSending] = useState(false)

  const valid = subject.trim().length >= 3 && body.trim().length >= 1

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError('')
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Apenas JPEG, PNG, WEBP ou GIF.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`Imagem muito grande (máx 5 MB — atual ${(file.size / 1024 / 1024).toFixed(1)} MB).`)
      return
    }
    const reader = new FileReader()
    reader.onload  = () => setAttachment(reader.result as string)
    reader.onerror = () => setError('Falha ao ler a imagem.')
    reader.readAsDataURL(file)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || sending) return
    setSending(true); setError('')
    try {
      const payload: { subject: string; body: string; attachmentUrl?: string } = {
        subject: subject.trim(),
        body:    body.trim(),
      }
      if (attachment) payload.attachmentUrl = attachment
      const { data } = await api.post('/tickets', payload)
      if (data?.ticket) onCreated(data.ticket as ApiTicket)
      else onClose()
    } catch (e: any) {
      const code = e?.response?.data?.error
      if (code === 'VALIDATION_ERROR') {
        setError('Verifique os dados informados.')
      } else {
        setError('Falha ao criar ticket. Tente novamente.')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/70">
      <div className="relative w-full max-w-md bg-[#1a1e2e] border border-[#2a2e3b] rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e3b]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <MessageSquare size={15} className="text-white" />
            </div>
            <h2 className="text-base font-bold text-white">Novo ticket</h2>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={submit} className="px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">Assunto</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex: dúvidas"
              maxLength={200}
              className="w-full bg-[#252a3a] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">Mensagem</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Descreva sua dúvida ou problema..."
              rows={5}
              maxLength={5000}
              className="w-full bg-[#252a3a] border border-[#2a2e3b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60 resize-none"
            />
            <p className="text-[10px] text-[#6b6f7a] mt-1 text-right">{body.length}/5000</p>
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#8b8f9a] mb-1 block">Anexo (opcional)</label>
            {attachment ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment} alt="prévia" className="h-28 rounded-lg border border-[#2a2e3b]" />
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-400 text-white flex items-center justify-center shadow-md"
                  title="Remover anexo"
                >
                  <ImageOff size={11} />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#252a3a] border border-dashed border-[#2a2e3b] text-xs text-[#8b8f9a] hover:text-white hover:border-blue-500/40 cursor-pointer transition-colors">
                <Paperclip size={13} />
                <span>Adicionar imagem (JPEG, PNG, WEBP — máx 5 MB)</span>
                <input
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </label>
            )}
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!valid || sending}
            className="h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
            {sending ? 'Enviando…' : 'Enviar ticket'}
          </button>
        </form>
      </div>
    </div>
  )
}
