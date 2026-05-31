import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SafeMode } from '@/components/system/SafeMode'
import { ImpersonationBanner } from '@/components/system/ImpersonationBanner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'VX Global — Trading Platform',
  description: 'Plataforma de negociação de opções digitais',
  icons: {
    // Next.js also auto-detects /app/icon.png — this is just the explicit fallback.
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className={`${inter.className} h-full overflow-hidden`}>
        {/* Anti-DevTools deterrent — no-op until admin toggles
            safeModeEnabled in /admin/configuracoes. Self-skips on /admin/*. */}
        <SafeMode />
        <ImpersonationBanner />
        {children}
      </body>
    </html>
  )
}
