import Link from 'next/link'
import {
  ArrowRight, ArrowUpRight, BarChart3, Bitcoin, Banknote, Clock,
  Globe, LineChart, ShieldCheck, Smartphone, TrendingUp, Wallet, Zap,
} from 'lucide-react'
import { Logo } from '@/components/layout/Logo'

export const metadata = {
  title: 'VX Global — Negocie opções digitais em segundos',
  description:
    'Plataforma profissional de opções digitais com gráficos em tempo real, mais de 200 ativos, demo gratuita e saques rápidos via PIX.',
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0b0d12] text-white antialiased">
      <SiteHeader />
      <main>
        <Hero />
        <StatsBar />
        <Features />
        <Markets />
        <HowItWorks />
        <FinalCTA />
      </main>
      <SiteFooter />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────────────────────

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#1f232e] bg-[#0b0d12]/85 backdrop-blur">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16">
        <Logo size="md" />

        <nav className="hidden md:flex items-center gap-7 text-sm text-[#cfd2d8]">
          <a href="#mercados"      className="hover:text-white transition-colors">Mercados</a>
          <a href="#como-funciona" className="hover:text-white transition-colors">Como funciona</a>
          <a href="#features"      className="hover:text-white transition-colors">Plataforma</a>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden sm:inline-flex items-center px-4 h-9 rounded-lg text-sm font-semibold text-white/90 hover:text-white transition-colors"
          >
            Entrar
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-sm font-bold text-white transition-colors"
          >
            Criar conta
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Hero
// ────────────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-20 right-0 w-[420px] h-[420px] rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-16 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold tracking-wider uppercase text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Plataforma ao vivo
          </span>

          <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05]">
            Negocie opções digitais em <span className="text-emerald-400">segundos</span>.
          </h1>

          <p className="mt-5 text-base sm:text-lg text-[#cfd2d8] max-w-xl leading-relaxed">
            Gráficos em tempo real, mais de 200 ativos entre Forex, Criptomoedas e OTC.
            Comece grátis com a conta demo de R$ 10.000.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-base font-bold text-white transition-colors shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)]"
            >
              Começar agora
              <ArrowRight size={18} />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg border border-[#2a2f3b] bg-[#13161f] hover:bg-[#1a1e2a] text-base font-semibold text-white transition-colors"
            >
              Testar conta demo
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#8b8f9a]">
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-400" /> Saques via PIX</span>
            <span className="flex items-center gap-1.5"><Clock      size={14} className="text-emerald-400" /> Operações a partir de 30s</span>
            <span className="flex items-center gap-1.5"><Smartphone size={14} className="text-emerald-400" /> Web e mobile</span>
          </div>
        </div>

        <HeroChartCard />
      </div>
    </section>
  )
}

function HeroChartCard() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-transparent to-blue-500/20 blur-2xl" aria-hidden />
      <div className="relative rounded-2xl border border-[#1f232e] bg-[#13161f]/90 backdrop-blur p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Bitcoin size={18} className="text-orange-400" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">BTC/USD</div>
              <div className="text-[10px] text-[#8b8f9a]">Bitcoin</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-emerald-400 tabular-nums">$ 72.418,30</div>
            <div className="text-[10px] text-emerald-400 flex items-center gap-1 justify-end">
              <TrendingUp size={10} /> +2,84%
            </div>
          </div>
        </div>

        <div className="relative h-44 rounded-lg border border-[#1f232e] bg-[#0f1117] overflow-hidden">
          <svg viewBox="0 0 400 160" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="rgb(16,185,129)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="hero-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="rgb(16,185,129)" />
                <stop offset="100%" stopColor="rgb(52,211,153)" />
              </linearGradient>
            </defs>
            <g stroke="rgba(255,255,255,0.04)" strokeWidth="1">
              <line x1="0" y1="40"  x2="400" y2="40"  />
              <line x1="0" y1="80"  x2="400" y2="80"  />
              <line x1="0" y1="120" x2="400" y2="120" />
            </g>
            <path
              d="M0,110 L25,95 L50,100 L80,85 L110,90 L140,72 L170,80 L200,60 L230,68 L260,48 L290,55 L320,40 L350,32 L400,22 L400,160 L0,160 Z"
              fill="url(#hero-area)"
            />
            <path
              d="M0,110 L25,95 L50,100 L80,85 L110,90 L140,72 L170,80 L200,60 L230,68 L260,48 L290,55 L320,40 L350,32 L400,22"
              fill="none"
              stroke="url(#hero-line)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx="400" cy="22" r="4" fill="rgb(52,211,153)" />
            <circle cx="400" cy="22" r="9" fill="rgb(52,211,153)" fillOpacity="0.2" />
          </svg>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400">COMPRAR</span>
            <ArrowUpRight size={16} className="text-emerald-400" />
          </div>
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-red-400">VENDER</span>
            <ArrowUpRight size={16} className="text-red-400 rotate-90" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[{ k: 'Investimento', v: 'R$ 100' }, { k: 'Tempo', v: '60s' }, { k: 'Payout', v: '92%' }].map((x) => (
            <div key={x.k} className="rounded-lg bg-[#0f1117] border border-[#1f232e] px-2 py-2">
              <div className="text-[9px] text-[#8b8f9a] uppercase tracking-wider">{x.k}</div>
              <div className="text-[13px] font-bold text-white mt-0.5">{x.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────────────────────────

function StatsBar() {
  const stats = [
    { v: '+200',    k: 'Ativos disponíveis' },
    { v: 'até 92%', k: 'Payout por operação' },
    { v: '30s',     k: 'Operação mais curta' },
    { v: '24/7',    k: 'Mercados OTC' },
  ]
  return (
    <section className="border-y border-[#1f232e] bg-[#0f1117]/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((s) => (
          <div key={s.k} className="text-center lg:text-left">
            <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{s.v}</div>
            <div className="text-xs text-[#8b8f9a] mt-1">{s.k}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Features
// ────────────────────────────────────────────────────────────────────────────

function Features() {
  const items = [
    {
      icon: <LineChart size={20} className="text-emerald-400" />,
      title: 'Gráficos profissionais',
      text:  'Velas em tempo real, indicadores e ferramentas de desenho. A mesma experiência das mesas profissionais.',
    },
    {
      icon: <Zap size={20} className="text-emerald-400" />,
      title: 'Execução instantânea',
      text:  'Abra e feche operações em milissegundos. Sem requote, sem atrasos.',
    },
    {
      icon: <Wallet size={20} className="text-emerald-400" />,
      title: 'PIX e saques rápidos',
      text:  'Depósito via PIX. Retiradas processadas rapidamente, direto na sua conta.',
    },
    {
      icon: <ShieldCheck size={20} className="text-emerald-400" />,
      title: 'Segurança em primeiro lugar',
      text:  'Autenticação em dois fatores e separação de saldo real e demo.',
    },
  ]
  return (
    <section id="features" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
      <SectionHeading
        eyebrow="Plataforma"
        title="Tudo que você precisa para operar"
        subtitle="Ferramentas projetadas para quem está começando e para quem opera sério."
      />
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-[#1f232e] bg-[#13161f] p-6 hover:border-emerald-500/40 transition-colors"
          >
            <div className="w-11 h-11 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              {f.icon}
            </div>
            <h3 className="mt-4 text-base font-bold text-white">{f.title}</h3>
            <p className="mt-2 text-sm text-[#8b8f9a] leading-relaxed">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Markets
// ────────────────────────────────────────────────────────────────────────────

function Markets() {
  const markets = [
    { icon: <Globe     size={18} />, label: 'Forex',        pairs: 'EUR/USD, GBP/USD, USD/JPY, +30', iconText: 'text-blue-400',   iconBg: 'bg-blue-500/10',   iconBorder: 'border-blue-500/30'   },
    { icon: <Bitcoin   size={18} />, label: 'Criptomoedas', pairs: 'BTC, ETH, SOL, XRP, +20',         iconText: 'text-orange-400', iconBg: 'bg-orange-500/10', iconBorder: 'border-orange-500/30' },
    { icon: <BarChart3 size={18} />, label: 'OTC',          pairs: 'Pares OTC ativos 24/7',           iconText: 'text-purple-400', iconBg: 'bg-purple-500/10', iconBorder: 'border-purple-500/30' },
    { icon: <Banknote  size={18} />, label: 'Commodities',  pairs: 'Ouro, Prata, Petróleo, +5',       iconText: 'text-yellow-400', iconBg: 'bg-yellow-500/10', iconBorder: 'border-yellow-500/30' },
  ]
  return (
    <section id="mercados" className="border-y border-[#1f232e] bg-[#0f1117]/40 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Mercados"
          title="Mais de 200 ativos para operar"
          subtitle="Acesse os principais mercados do mundo em uma única conta."
        />
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {markets.map((m) => (
            <div key={m.label} className="rounded-xl border border-[#1f232e] bg-[#13161f] p-6">
              <div className={`w-11 h-11 rounded-lg ${m.iconBg} border ${m.iconBorder} flex items-center justify-center ${m.iconText}`}>
                {m.icon}
              </div>
              <h3 className="mt-4 text-base font-bold text-white">{m.label}</h3>
              <p className="mt-1.5 text-xs text-[#8b8f9a]">{m.pairs}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// How it works
// ────────────────────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    { n: 1, title: 'Crie sua conta',   text: 'Cadastro em menos de 1 minuto. Comece com a conta demo de R$ 10.000.' },
    { n: 2, title: 'Deposite via PIX', text: 'Depósito instantâneo a partir de R$ 50. Sem taxas escondidas.' },
    { n: 3, title: 'Opere e saque',    text: 'Compre opções de alta ou baixa. Retire seus lucros via PIX.' },
  ]
  return (
    <section id="como-funciona" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
      <SectionHeading
        eyebrow="Como funciona"
        title="Comece em 3 passos simples"
      />
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
        {steps.map((s) => (
          <div key={s.n} className="relative rounded-xl border border-[#1f232e] bg-[#13161f] p-6">
            <div className="w-10 h-10 rounded-full bg-emerald-500 text-white font-bold flex items-center justify-center text-lg shadow-[0_6px_18px_-6px_rgba(16,185,129,0.6)]">
              {s.n}
            </div>
            <h3 className="mt-5 text-lg font-bold text-white">{s.title}</h3>
            <p className="mt-2 text-sm text-[#8b8f9a] leading-relaxed">{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Final CTA
// ────────────────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-24">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-[#13161f] via-[#13161f] to-emerald-950/40 px-6 sm:px-12 py-12 sm:py-16 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Pronto para começar a operar?
          </h2>
          <p className="mt-3 text-[#cfd2d8] text-base max-w-xl mx-auto">
            Crie sua conta gratuita agora e ganhe R$ 10.000 em saldo demo para praticar.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-base font-bold text-white transition-colors shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)]"
            >
              Criar conta grátis
              <ArrowRight size={18} />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-12 px-7 rounded-lg border border-[#2a2f3b] bg-[#0f1117] hover:bg-[#1a1e2a] text-base font-semibold text-white transition-colors"
            >
              Já tenho conta
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Footer
// ────────────────────────────────────────────────────────────────────────────

function SiteFooter() {
  return (
    <footer className="border-t border-[#1f232e] bg-[#0a0c11]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-2 lg:grid-cols-4 gap-8">
        <div className="col-span-2 lg:col-span-1">
          <Logo size="md" />
          <p className="mt-4 text-xs text-[#8b8f9a] leading-relaxed max-w-xs">
            Plataforma de opções digitais para o trader moderno.
          </p>
        </div>

        <FooterCol title="Plataforma" items={[
          { label: 'Mercados',       href: '#mercados'      },
          { label: 'Como funciona',  href: '#como-funciona' },
          { label: 'Recursos',       href: '#features'      },
        ]} />
        <FooterCol title="Conta" items={[
          { label: 'Entrar',      href: '/login'    },
          { label: 'Criar conta', href: '/register' },
        ]} />
        <FooterCol title="Legal" items={[
          { label: 'Termos de uso',           href: '#' },
          { label: 'Política de privacidade', href: '#' },
          { label: 'Aviso de risco',          href: '#' },
        ]} />
      </div>

      <div className="border-t border-[#1f232e]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px] text-[#6f7480]">
          <p className="max-w-3xl leading-relaxed">
            <strong className="text-[#8b8f9a]">Aviso de risco:</strong> a negociação de opções digitais envolve risco
            elevado e pode resultar na perda total do capital investido. Opere apenas com valores
            que você pode se dar ao luxo de perder.
          </p>
          <p className="flex-shrink-0">© {new Date().getFullYear()} VX Global. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, items }: { title: string; items: { label: string; href: string }[] }) {
  return (
    <div>
      <div className="text-xs font-bold text-white uppercase tracking-wider">{title}</div>
      <ul className="mt-4 space-y-2.5">
        {items.map((i) => (
          <li key={i.label}>
            <Link href={i.href} className="text-sm text-[#8b8f9a] hover:text-white transition-colors">
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Shared
// ────────────────────────────────────────────────────────────────────────────

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="max-w-2xl">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">{eyebrow}</div>
      <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">{title}</h2>
      {subtitle && <p className="mt-4 text-base text-[#8b8f9a] leading-relaxed">{subtitle}</p>}
    </div>
  )
}
