'use client'

import { X, GraduationCap, Gem, ArrowRight } from 'lucide-react'

interface AccountSwitchModalProps {
  switchedTo: 'demo' | 'real'
  demoBalance: number
  realBalance: number
  onClose: () => void
}

export function AccountSwitchModal({
  switchedTo,
  demoBalance,
  realBalance,
  onClose,
}: AccountSwitchModalProps) {
  const isNowReal = switchedTo === 'real'

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      {/* Modal card */}
      <div className="bg-[#1e2235] rounded-2xl shadow-2xl w-[440px] overflow-hidden border border-[#2a2e3b]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-base font-semibold text-white">
            O tipo de conta foi alterado
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#8b8f9a] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-[#2a2e3b] mx-6" />

        {/* Subtitle */}
        <p className="text-sm text-[#8b8f9a] text-center px-6 pt-4 pb-5">
          {isNowReal
            ? 'Agora você está negociando em uma conta real'
            : 'Agora você está negociando em uma conta demo'}
        </p>

        {/* Account cards */}
        <div className="flex items-center justify-center gap-3 px-6 pb-6">
          {/* Demo card — origin when switching to real, destination when switching to demo */}
          <div className={`flex-1 rounded-xl border p-4 flex flex-col items-center gap-2 transition-colors ${
            !isNowReal
              ? 'border-green-500/50 bg-[#252a3a]'
              : 'border-[#2a2e3b] bg-[#181c2a] opacity-60'
          }`}>
            <GraduationCap
              size={28}
              className={!isNowReal ? 'text-yellow-400' : 'text-[#8b8f9a]'}
            />
            <div className={`text-[10px] font-bold tracking-widest ${
              !isNowReal ? 'text-yellow-400' : 'text-[#8b8f9a]'
            }`}>
              CONTA DEMO
            </div>
            <div className={`text-sm font-bold ${!isNowReal ? 'text-white' : 'text-[#8b8f9a]'}`}>
              R${demoBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>

          {/* Arrow */}
          <ArrowRight size={20} className="text-blue-400 flex-shrink-0" />

          {/* Real card */}
          <div className={`flex-1 rounded-xl border p-4 flex flex-col items-center gap-2 transition-colors ${
            isNowReal
              ? 'border-green-500/50 bg-[#252a3a]'
              : 'border-[#2a2e3b] bg-[#181c2a] opacity-60'
          }`}>
            <Gem
              size={28}
              className={isNowReal ? 'text-purple-400' : 'text-[#8b8f9a]'}
            />
            <div className={`text-[10px] font-bold tracking-widest ${
              isNowReal ? 'text-green-400' : 'text-[#8b8f9a]'
            }`}>
              CONTA REAL
            </div>
            <div className={`text-sm font-bold ${isNowReal ? 'text-white' : 'text-[#8b8f9a]'}`}>
              R${realBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Close button */}
        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-[#2a2e3b] hover:bg-[#343a4f] transition-colors text-sm font-semibold text-white"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  )
}
