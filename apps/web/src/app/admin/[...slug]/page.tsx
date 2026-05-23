'use client'

import { Construction } from 'lucide-react'
import { useParams } from 'next/navigation'

// Stub page for every /admin/* route that hasn't been implemented yet. The
// sidebar links go to all the planned sections — instead of 404'ing, we
// surface a friendly placeholder with the section name parsed from the URL.

export default function AdminStubPage() {
  const params = useParams()
  const slug   = Array.isArray(params?.slug) ? params.slug.join(' / ') : (params?.slug as string ?? '')
  const title  = slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-6">
      <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4">
        <Construction size={22} className="text-emerald-400" />
      </div>
      <h1 className="text-xl font-bold text-white mb-2">{title || 'Seção'}</h1>
      <p className="text-sm text-[#8b8f9a] max-w-md">
        Este módulo do painel administrativo será construído na próxima fase
        do roadmap. Por enquanto só o Dashboard está disponível.
      </p>
    </div>
  )
}
