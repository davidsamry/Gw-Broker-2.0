'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, MessageSquare, Plus, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type SupportTab = 'solicitacoes' | 'criar' | 'faq'

const MOCK_TICKETS = [
  {
    id: '5176988',
    date: '29/01/2023',
    lastMessage: {
      sender: 'Suporte',
      text: 'Olá,',
      preview: '...',
      datetime: '29/01/2023 20:53:34',
    },
    status: 'resolved',
  },
]

const FAQ_ITEMS = [
  { question: 'Como fazer um depósito?', answer: 'Acesse Depósito no menu superior e escolha PIX ou cartão.' },
  { question: 'Como sacar meu dinheiro?', answer: 'Acesse Retirada, informe o valor e os dados bancários.' },
  { question: 'O que é conta demo?', answer: 'É uma conta com saldo virtual para praticar sem risco real.' },
  { question: 'Qual o depósito mínimo?', answer: 'O depósito mínimo é de R$30,00 via PIX.' },
  { question: 'Como funciona o payout?', answer: 'O payout é o percentual de lucro sobre o investimento em caso de acerto.' },
  { question: 'Posso cancelar uma operação?', answer: 'Operações não podem ser canceladas após confirmadas.' },
]

export function SupportPage() {
  const [tab, setTab] = useState<SupportTab>('solicitacoes')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  return (
    <div className="flex-1 flex flex-col bg-[#151822] min-h-0 overflow-hidden">

      {/* Tabs bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#2a2e3b] bg-[#1a1e2e] flex-shrink-0">
        <div className="flex items-center gap-1">
          {[
            { key: 'solicitacoes', label: 'Minhas solicitações', icon: <MessageSquare size={14} /> },
            { key: 'criar', label: 'Criar solicitação', icon: <Plus size={14} /> },
            { key: 'faq', label: 'Perguntas frequentes', icon: <HelpCircle size={14} /> },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as SupportTab)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                tab === t.key
                  ? 'bg-white text-[#151822] font-semibold'
                  : 'text-[#8b8f9a] hover:text-white hover:bg-white/5'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Pagination */}
        {tab === 'solicitacoes' && (
          <div className="flex items-center gap-2">
            <button className="w-7 h-7 flex items-center justify-center rounded border border-[#2a2e3b] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-[#8b8f9a] font-medium">1/1</span>
            <button className="w-7 h-7 flex items-center justify-center rounded border border-[#2a2e3b] text-[#8b8f9a] hover:text-white hover:border-white/30 transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* Minhas solicitações */}
        {tab === 'solicitacoes' && (
          <div className="px-6 py-4">
            {/* Table header */}
            <div className="grid grid-cols-[200px_1fr_200px] gap-4 px-4 py-2 mb-1">
              <span className="text-xs text-[#8b8f9a] font-medium">Solicitação</span>
              <span className="text-xs text-[#8b8f9a] font-medium">Última mensagem</span>
              <span className="text-xs text-[#8b8f9a] font-medium">Status</span>
            </div>

            {MOCK_TICKETS.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <MessageSquare size={40} className="text-[#3a3f50]" />
                <p className="text-sm text-[#8b8f9a]">Nenhuma solicitação encontrada</p>
              </div>
            ) : (
              MOCK_TICKETS.map((ticket) => (
                <div
                  key={ticket.id}
                  className="grid grid-cols-[200px_1fr_200px] gap-4 px-4 py-4 rounded-xl bg-[#1a1e2e] border border-[#2a2e3b] mb-2 hover:border-blue-500/30 transition-colors cursor-pointer"
                >
                  {/* Ticket ID + date */}
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#252a3a] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <MessageSquare size={14} className="text-[#8b8f9a]" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-blue-400">#{ticket.id}</div>
                      <div className="text-xs text-[#8b8f9a] mt-0.5">{ticket.date}</div>
                    </div>
                  </div>

                  {/* Last message */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded">
                        {ticket.lastMessage.sender}:
                      </span>
                    </div>
                    <div className="text-sm text-white">{ticket.lastMessage.text}</div>
                    <div className="text-xs text-[#8b8f9a]">{ticket.lastMessage.preview}</div>
                    <div className="text-xs text-[#8b8f9a]">{ticket.lastMessage.datetime}</div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-2">
                    {ticket.status === 'resolved' && (
                      <>
                        <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-green-400">Problema resolvido</span>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Criar solicitação */}
        {tab === 'criar' && (
          <div className="px-6 py-6 max-w-2xl">
            <h2 className="text-base font-bold text-white mb-4">Nova solicitação</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-[#8b8f9a] tracking-wide mb-2 block">ASSUNTO</label>
                <input
                  type="text"
                  placeholder="Descreva o assunto brevemente"
                  className="w-full h-10 bg-[#1a1e2e] border border-[#2a2e3b] rounded-lg px-4 text-sm text-white placeholder-[#8b8f9a] outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#8b8f9a] tracking-wide mb-2 block">MENSAGEM</label>
                <textarea
                  rows={5}
                  placeholder="Descreva detalhadamente o problema ou dúvida..."
                  className="w-full bg-[#1a1e2e] border border-[#2a2e3b] rounded-lg px-4 py-3 text-sm text-white placeholder-[#8b8f9a] outline-none focus:border-blue-500/50 transition-colors resize-none"
                />
              </div>
              <button className="w-fit px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm font-bold text-white">
                Enviar solicitação
              </button>
            </div>
          </div>
        )}

        {/* Perguntas frequentes */}
        {tab === 'faq' && (
          <div className="px-6 py-6 max-w-2xl">
            <h2 className="text-base font-bold text-white mb-4">Perguntas frequentes</h2>
            <div className="flex flex-col gap-2">
              {FAQ_ITEMS.map((item, i) => (
                <div
                  key={i}
                  className="bg-[#1a1e2e] border border-[#2a2e3b] rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
                  >
                    <span className="text-sm font-medium text-white">{item.question}</span>
                    <ChevronRight
                      size={16}
                      className={cn(
                        'text-[#8b8f9a] transition-transform flex-shrink-0',
                        expandedFaq === i && 'rotate-90'
                      )}
                    />
                  </button>
                  {expandedFaq === i && (
                    <div className="px-4 pb-4 text-sm text-[#8b8f9a] border-t border-[#2a2e3b] pt-3">
                      {item.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
