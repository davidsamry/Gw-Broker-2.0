'use client'

// VX Global — Landing institucional
//
// Servida em vx-global.com/ (root publico). Quem ja' tem conta clica em
// "Entrar no painel" e vai pra /app (onde mora a plataforma de trading
// — movida pra la' quando criamos essa landing).
//
// Layout root do site usa `body className="overflow-hidden h-full"` pra
// travar scroll do app de trading. Escapamos disso com um wrapper
// `fixed inset-0 overflow-y-auto` — cria scroll proprio sem precisar
// mexer no body (e sem flash de unstyled content).
//
// Animacoes: IntersectionObserver simples + classes .reveal/.in. Cores
// derivadas da paleta VX: #3080ff (primary) + #22d3ee (accent ciano) +
// #0e1019 (bg) + #171b27 (card). Tudo Tailwind inline pra evitar
// poluir o globals do app.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Zap, Shield, BarChart3, Smartphone, Wallet, Headphones,
  TrendingUp, Globe, LineChart, Briefcase,
  ArrowRight, CheckCircle2, ChevronDown, Star,
} from 'lucide-react'

// ── Reveal-on-scroll hook ────────────────────────────────────────────────
// Substitui o IntersectionObserver inline do mock do Rivox. Adiciona
// classe `in` aos filhos com `data-reveal` quando entram no viewport,
// reaproveitando os keyframes inline definidos abaixo.
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-reveal]:not(.in)')
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

// Animacao de contagem dos numeros do "metrics" — 2s de duracao,
// trigger uma unica vez quando a secao aparece.
function useCountUp(target: number, trigger: boolean, decimals = 0) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!trigger) return
    const duration = 1800
    const startedAt = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration)
      // ease-out cubic — comeca rapido, desacelera no fim
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(target * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else setValue(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, trigger])
  return decimals === 0 ? Math.floor(value) : Number(value.toFixed(decimals))
}

export default function VxLandingPage() {
  useReveal()

  // Trigger pra contagem dos numeros — aciona quando o bloco de metrics
  // entra no viewport (uma so' vez).
  const [metricsLive, setMetricsLive] = useState(false)
  const metricsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = metricsRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setMetricsLive(true)
          io.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const userCount = useCountUp(15000, metricsLive)
  const uptime    = useCountUp(99.9, metricsLive, 1)

  // Parallax sutil no grid de fundo — segue scroll com um leve offset.
  const [scrollY, setScrollY] = useState(0)
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    // Listener no wrapper (que tem o scroll real), nao no window.
    const wrapper = document.getElementById('landing-scroll')
    if (!wrapper) return
    const handler = () => setScrollY(wrapper.scrollTop)
    wrapper.addEventListener('scroll', handler, { passive: true })
    return () => wrapper.removeEventListener('scroll', handler)
  }, [])

  return (
    <div
      id="landing-scroll"
      className="fixed inset-0 overflow-y-auto overflow-x-hidden text-white"
      style={{
        background:
          'radial-gradient(1200px 800px at 20% 10%, rgba(48,128,255,0.18), transparent 65%),' +
          'radial-gradient(900px 600px at 85% 15%, rgba(34,211,238,0.12), transparent 60%),' +
          'radial-gradient(1100px 700px at 50% 50%, rgba(48,128,255,0.06), transparent 70%),' +
          'radial-gradient(900px 600px at 15% 85%, rgba(38,166,154,0.08), transparent 65%),' +
          'radial-gradient(800px 500px at 80% 90%, rgba(34,211,238,0.08), transparent 60%),' +
          'linear-gradient(180deg, #0a0c14, #0e1019 50%, #0b0d16)',
      }}
    >
      {/* Keyframes locais (sem poluir globals.css) */}
      <style jsx>{`
        [data-reveal] {
          opacity: 0;
          transform: translateY(18px);
          filter: blur(6px);
          transition: opacity .7s cubic-bezier(.2,.7,.2,1),
                      transform .7s cubic-bezier(.2,.7,.2,1),
                      filter .7s cubic-bezier(.2,.7,.2,1);
          will-change: opacity, transform, filter;
        }
        [data-reveal].in { opacity: 1; transform: none; filter: blur(0); }
        [data-stagger] > * {
          opacity: 0;
          transform: translateY(14px);
          filter: blur(6px);
          transition: opacity .7s cubic-bezier(.2,.7,.2,1),
                      transform .7s cubic-bezier(.2,.7,.2,1),
                      filter .7s cubic-bezier(.2,.7,.2,1);
        }
        [data-stagger].in > *           { opacity: 1; transform: none; filter: blur(0); }
        [data-stagger].in > *:nth-child(1) { transition-delay: .05s; }
        [data-stagger].in > *:nth-child(2) { transition-delay: .12s; }
        [data-stagger].in > *:nth-child(3) { transition-delay: .19s; }
        [data-stagger].in > *:nth-child(4) { transition-delay: .26s; }
        [data-stagger].in > *:nth-child(5) { transition-delay: .33s; }
        [data-stagger].in > *:nth-child(6) { transition-delay: .40s; }
        @keyframes pulseGlow {
          0%, 100% { opacity: .6; }
          50%      { opacity: 1; }
        }
        .live-dot { animation: pulseGlow 1.6s ease-in-out infinite; }
        @keyframes floatY {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        .floaty { animation: floatY 6s ease-in-out infinite; }
      `}</style>

      {/* Grid pattern de fundo com parallax */}
      <div
        className="pointer-events-none fixed inset-0 opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          maskImage: 'radial-gradient(closest-side at 50% 30%, rgba(0,0,0,.9), transparent 70%)',
          WebkitMaskImage: 'radial-gradient(closest-side at 50% 30%, rgba(0,0,0,.9), transparent 70%)',
          transform: `translateY(${scrollY * 0.25}px)`,
        }}
      />

      {/* HEADER */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0a0c14]/70 border-b border-white/5">
        <div className="mx-auto w-full max-w-[1180px] px-5 flex items-center justify-between py-3.5 gap-4">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <Image src="/vx-logo.png" alt="VX Global" width={120} height={36} className="h-9 w-auto" priority />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-white/70">
            <a href="#mercados"     className="hover:text-white transition-colors">Mercados</a>
            <a href="#recursos"     className="hover:text-white transition-colors">Recursos</a>
            <a href="#como-funciona" className="hover:text-white transition-colors">Como funciona</a>
            <a href="#faq"          className="hover:text-white transition-colors">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden sm:inline-flex items-center justify-center px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-white hover:bg-white/10 hover:border-white/20 transition"
            >
              Entrar
            </Link>
            <Link
              href="/login?tab=register"
              className="inline-flex items-center justify-center px-3.5 py-2 rounded-xl text-sm font-bold text-white transition hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, #3080ff, #22d3ee)',
                boxShadow: '0 14px 40px -8px rgba(48,128,255,.45)',
              }}
            >
              Abrir conta
            </Link>
          </div>
        </div>
      </header>

      <main className="relative">

        {/* HERO ─────────────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1180px] px-5 pt-14 md:pt-20 pb-8">
          <div className="grid md:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
            <div data-reveal className="in">
              <div className="inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-bold text-white/80">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />
                </span>
                <span><b className="text-white">Plataforma</b> rápida, segura, em tempo real</span>
              </div>

              <h1 className="mt-5 text-4xl md:text-[54px] font-black leading-[1.02] tracking-tight">
                A corretora que une{' '}
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: 'linear-gradient(90deg, #fff, #c8e0ff 50%, #22d3ee)' }}
                >
                  tecnologia
                </span>{' '}
                e segurança para você operar.
              </h1>

              <p className="mt-4 max-w-[55ch] text-white/70 leading-relaxed text-[15px]">
                Crypto, Forex e ativos OTC com execução abaixo de 1 segundo, depósitos via PIX e USDT,
                e uma interface pensada pra quem opera de verdade.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/login?tab=register"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold text-white transition hover:brightness-110"
                  style={{
                    background: 'linear-gradient(135deg, #3080ff, #22d3ee)',
                    boxShadow: '0 18px 55px -10px rgba(48,128,255,.5)',
                  }}
                >
                  Abrir minha conta
                  <ArrowRight size={16} />
                </Link>
                <a
                  href="#como-funciona"
                  className="inline-flex items-center px-5 py-3 rounded-2xl text-sm font-semibold text-white/90 border border-white/12 bg-white/5 hover:bg-white/10 transition"
                >
                  Como funciona
                </a>
              </div>

              {/* Trust micro-row */}
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/55">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-400" /> Conta demo grátis</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-400" /> Depósito instantâneo (PIX)</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-400" /> Suporte 24/7</span>
              </div>
            </div>

            {/* Hero mockup — painel de trade simulado */}
            <aside
              data-reveal
              className="in floaty rounded-[26px] overflow-hidden border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,.45)]"
              style={{
                background:
                  'radial-gradient(420px 280px at 30% 15%, rgba(48,128,255,.22), transparent 60%),' +
                  'radial-gradient(420px 280px at 80% 25%, rgba(34,211,238,.15), transparent 55%),' +
                  'rgba(255,255,255,.035)',
              }}
            >
              {/* Top bar mock */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2.5">
                <div className="flex gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                </div>
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />
                  AO VIVO · BTC/USD
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <MockStat label="Saldo" value="R$ 12.847,32" up />
                  <MockStat label="Hoje" value="+R$ 384,90" up positive />
                </div>
                {/* Mini chart canvas-ish */}
                <div
                  className="relative h-32 rounded-2xl border border-white/8 overflow-hidden"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.012)),' +
                      'radial-gradient(160px 100px at 30% 70%, rgba(48,128,255,.32), transparent 60%),' +
                      'radial-gradient(160px 100px at 75% 35%, rgba(34,211,238,.22), transparent 60%)',
                  }}
                >
                  <svg viewBox="0 0 320 120" className="absolute inset-0 w-full h-full">
                    <defs>
                      <linearGradient id="line" x1="0" x2="1" y1="0" y2="0">
                        <stop offset="0%" stopColor="#3080ff" />
                        <stop offset="100%" stopColor="#22d3ee" />
                      </linearGradient>
                      <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(48,128,255,.4)" />
                        <stop offset="100%" stopColor="rgba(48,128,255,0)" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0,90 C40,60 70,80 100,55 C130,30 160,70 200,45 C240,20 270,60 320,30 L320,120 L0,120 Z"
                      fill="url(#area)"
                    />
                    <path
                      d="M0,90 C40,60 70,80 100,55 C130,30 160,70 200,45 C240,20 270,60 320,30"
                      fill="none"
                      stroke="url(#line)"
                      strokeWidth={2.4}
                    />
                  </svg>
                </div>
                {/* Buy/Sell mock */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl px-3 py-2.5 text-center font-bold text-sm text-white border border-emerald-500/40 bg-emerald-500/15">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">Comprar</div>
                    <div>62.347,80</div>
                  </div>
                  <div className="rounded-xl px-3 py-2.5 text-center font-bold text-sm text-white border border-rose-500/40 bg-rose-500/15">
                    <div className="text-[10px] uppercase tracking-wider text-rose-300/80">Vender</div>
                    <div>62.341,20</div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* METRICS ──────────────────────────────────────────────────────── */}
        <section
          ref={metricsRef}
          className="mx-auto w-full max-w-[1180px] px-5 py-10"
        >
          <div
            data-stagger
            data-reveal
            className="grid grid-cols-2 md:grid-cols-4 gap-3.5"
          >
            <MetricCard num={`+${(userCount / 1000).toFixed(0)}k`} label="Traders ativos" />
            <MetricCard num="24/7" label="Suporte humano" />
            <MetricCard num={`${uptime.toFixed(1)}%`} label="Uptime garantido" />
            <MetricCard num="<1s" label="Execução de ordens" />
          </div>
        </section>

        {/* MERCADOS ─────────────────────────────────────────────────────── */}
        <section id="mercados" className="mx-auto w-full max-w-[1180px] px-5 py-14">
          <h2 data-reveal className="text-3xl md:text-4xl font-black tracking-tight text-center">
            Mercados disponíveis
          </h2>
          <p data-reveal className="mt-2 mx-auto max-w-[60ch] text-center text-white/65 leading-relaxed">
            Mais de 70 ativos pra você diversificar — todos com cotação em tempo real.
          </p>

          <div data-stagger data-reveal className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MarketCard
              icon={<Coin />}
              title="Crypto"
              desc="BTC, ETH, SOL, XRP e mais. Operações 24/7 com payout até 92%."
              tag="92% payout"
              tagColor="#22d3ee"
            />
            <MarketCard
              icon={<Globe size={22} />}
              title="Forex"
              desc="EUR/USD, GBP/JPY, USD/BRL. Liquidez global, spreads competitivos."
              tag="80+ pares"
              tagColor="#3080ff"
            />
            <MarketCard
              icon={<LineChart size={22} />}
              title="OTC"
              desc="Mercados sintéticos que rodam 24/7, inclusive nos finais de semana."
              tag="Sempre aberto"
              tagColor="#26a69a"
            />
            <MarketCard
              icon={<Briefcase size={22} />}
              title="Ações & Commodities"
              desc="Apple, Microsoft, ouro, petróleo. Diversifique além das cripto."
              tag="Top mercados"
              tagColor="#eab308"
            />
          </div>
        </section>

        {/* COMO FUNCIONA ────────────────────────────────────────────────── */}
        <section id="como-funciona" className="mx-auto w-full max-w-[1180px] px-5 py-14">
          <h2 data-reveal className="text-2xl md:text-3xl font-black tracking-tight">Como funciona</h2>
          <p data-reveal className="mt-2 max-w-[60ch] text-white/65 leading-relaxed">
            Em três passos você sai do zero pra operar de verdade.
          </p>

          <div data-stagger data-reveal className="mt-8 grid md:grid-cols-3 gap-4">
            <StepCard n="1" title="Cadastre-se" desc="Preencha seu e-mail e CPF. Aprovação automática em minutos." />
            <StepCard n="2" title="Deposite via PIX ou USDT" desc="A partir de R$ 60 (PIX) ou USDT TRC20. Saldo crédita na hora." />
            <StepCard n="3" title="Comece a operar" desc="Escolha o ativo, defina valor e direção. Resultado em segundos." />
          </div>
        </section>

        {/* RECURSOS ─────────────────────────────────────────────────────── */}
        <section
          id="recursos"
          className="py-16"
          style={{
            background:
              'radial-gradient(900px 500px at 30% 50%, rgba(34,211,238,.08), transparent 65%),' +
              'radial-gradient(700px 400px at 75% 50%, rgba(48,128,255,.07), transparent 60%)',
          }}
        >
          <div className="mx-auto w-full max-w-[1180px] px-5">
            <h2 data-reveal className="text-center text-3xl md:text-4xl font-black tracking-tight">
              Recursos que fazem{' '}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}
              >
                diferença
              </span>
            </h2>
            <p data-reveal className="mt-2 mx-auto max-w-[65ch] text-center text-white/65 leading-relaxed">
              A plataforma foi feita pra quem quer operar com confiança — não pra te confundir.
            </p>

            <div data-stagger data-reveal className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <FeatureCard icon={<Zap size={20} />} title="Execução abaixo de 1s" desc="Ordens executadas sem delay perceptível, mesmo em dias de alta volatilidade." />
              <FeatureCard icon={<Shield size={20} />} title="Segurança em camadas" desc="2FA obrigatório, sessões assinadas e proteção anti-fraude no backend." />
              <FeatureCard icon={<BarChart3 size={20} />} title="Gráficos em tempo real" desc="Candles diretos da Binance / Twelve Data — sem atraso, sem mock." />
              <FeatureCard icon={<Wallet size={20} />} title="Depósitos instantâneos" desc="PIX em até 30 segundos e USDT TRC20 com confirmação on-chain." />
              <FeatureCard icon={<Smartphone size={20} />} title="Mobile-first" desc="Interface responsiva pra você operar do celular sem perder funcionalidade." />
              <FeatureCard icon={<Headphones size={20} />} title="Suporte 24/7" desc="Equipe disponível todo dia via ticket. Resposta média abaixo de 15 minutos." />
            </div>
          </div>
        </section>

        {/* TESTIMONIALS ─────────────────────────────────────────────────── */}
        <section
          className="py-16"
          style={{
            background:
              'radial-gradient(1000px 600px at 50% 50%, rgba(48,128,255,.10), transparent 70%),' +
              'radial-gradient(800px 500px at 20% 50%, rgba(34,211,238,.06), transparent 65%)',
          }}
        >
          <div className="mx-auto w-full max-w-[1180px] px-5">
            <h2 data-reveal className="text-center text-2xl md:text-3xl font-black tracking-tight">
              O que dizem nossos traders
            </h2>
            <p data-reveal className="mt-2 mx-auto max-w-[60ch] text-center text-white/65 leading-relaxed">
              Milhares de operações por dia. Resultado de uma plataforma que respeita o tempo do trader.
            </p>

            <div data-stagger data-reveal className="mt-10 grid md:grid-cols-3 gap-4">
              <TestimonialCard initials="CS" color="#3080ff" name="Carlos Silva" role="Day trader · 3 anos" quote="A execução é absurdamente rápida. Migrei de outra corretora e a diferença é gritante — nunca mais perdi entrada por travamento." />
              <TestimonialCard initials="MS" color="#22d3ee" name="Maria Santos" role="Day trader" quote="Interface limpa, sem firula. Tudo na mão. O suporte responde em minutos, mesmo de madrugada." />
              <TestimonialCard initials="JP" color="#26a69a" name="João Pedro" role="Investidor"   quote="Saques caem rápido e a transparência é o que faz eu confiar. PIX em minutos, USDT no mesmo dia." />
            </div>
          </div>
        </section>

        {/* FAQ ─────────────────────────────────────────────────────────── */}
        <section id="faq" className="mx-auto w-full max-w-[920px] px-5 py-14">
          <h2 data-reveal className="text-2xl md:text-3xl font-black tracking-tight">Perguntas frequentes</h2>
          <p data-reveal className="mt-2 text-white/65 leading-relaxed">Tire suas dúvidas sobre a plataforma antes de começar.</p>

          <div data-stagger data-reveal className="mt-8 space-y-2.5">
            <FaqItem q="Como abro minha conta?" a="Clique em 'Abrir conta', preencha e-mail, senha e CPF. A aprovação leva minutos. Você pode operar imediatamente em conta demo (R$ 10.000 fictícios) enquanto valida sua conta real." />
            <FaqItem q="Qual o depósito mínimo?" a="O mínimo é R$ 60 via PIX. Para USDT TRC20 também é o equivalente a R$ 60 (calculado pela cotação do momento via Binance)." />
            <FaqItem q="A plataforma é segura?" a="Sim. Usamos 2FA obrigatório, sessões com tokens assinados HMAC, banco de dados criptografado em repouso e auditoria de cada ação administrativa." />
            <FaqItem q="Posso operar pelo celular?" a="Sim — a plataforma é responsiva e funciona no navegador do celular sem necessidade de instalar app." />
            <FaqItem q="Quanto tempo demora um saque?" a="Saques via PIX são processados em até 24 horas úteis. Na maioria dos casos cai em minutos. USDT no mesmo dia." />
            <FaqItem q="Vocês oferecem conta demo?" a="Sim, gratuitamente e sem limite de tempo. Você troca entre demo e real a qualquer momento no painel." />
          </div>
        </section>

        {/* CTA FINAL ───────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1180px] px-5 py-14">
          <div
            data-reveal
            className="relative overflow-hidden rounded-3xl border border-white/10 p-10 md:p-14 text-center"
            style={{
              background:
                'radial-gradient(700px 350px at 50% 0%, rgba(48,128,255,.28), transparent 65%),' +
                'radial-gradient(500px 280px at 80% 100%, rgba(34,211,238,.18), transparent 60%),' +
                'rgba(10,12,20,.6)',
            }}
          >
            <h2 className="text-3xl md:text-4xl font-black tracking-tight">
              Pronto pra começar?
            </h2>
            <p className="mt-3 mx-auto max-w-[55ch] text-white/70 leading-relaxed">
              Crie sua conta agora e teste a plataforma com demo gratuita. Sem cartão de crédito, sem compromisso.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href="/login?tab=register"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-bold text-white transition hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #3080ff, #22d3ee)',
                  boxShadow: '0 18px 55px -10px rgba(48,128,255,.5)',
                }}
              >
                Abrir minha conta grátis
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center px-6 py-3.5 rounded-2xl text-sm font-semibold text-white/90 border border-white/12 bg-white/5 hover:bg-white/10 transition"
              >
                Já tenho conta
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER de risco */}
      <footer
        className="relative py-14 border-t border-white/5"
        style={{
          background:
            'radial-gradient(1000px 500px at 20% 20%, rgba(48,128,255,.14), transparent 65%),' +
            'radial-gradient(900px 450px at 85% 30%, rgba(34,211,238,.10), transparent 60%),' +
            'linear-gradient(180deg, rgba(10,12,20,.25), rgba(10,12,20,.55))',
        }}
      >
        <div className="mx-auto w-full max-w-[1180px] px-5 text-white/55">
          <h3 className="font-bold text-white/80 text-sm tracking-wide">AVISO DE RISCO</h3>
          <p className="mt-3 text-[13px] leading-relaxed max-w-[110ch]">
            Operações financeiras envolvem riscos significativos e podem não ser adequadas para todos os investidores.
            O desempenho passado não é garantia de resultados futuros. Antes de operar, certifique-se de entender
            completamente os riscos envolvidos e considere seus objetivos de investimento, nível de experiência e
            apetite ao risco. Você pode perder parte ou todo o seu capital investido. Não invista dinheiro que você
            não pode perder.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed max-w-[110ch]">
            A VX Global não oferece consultoria financeira ou de investimento. Todo o conteúdo disponibilizado é
            apenas para fins informativos e educacionais. As decisões de investimento são de sua exclusiva
            responsabilidade.
          </p>

          <div className="mt-10 pt-5 border-t border-white/5 flex flex-wrap items-center justify-between gap-3 text-[13px]">
            <div className="flex items-center gap-2 opacity-90">
              <Image src="/vx-icon.png" alt="" width={20} height={20} className="opacity-80" />
              <span>© {new Date().getFullYear()} VX Global. Todos os direitos reservados.</span>
            </div>
            <div className="flex gap-5 text-white/55">
              <Link href="/login" className="hover:text-white transition-colors">Entrar</Link>
              <Link href="/login?tab=register" className="hover:text-white transition-colors">Abrir conta</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────────

function MockStat({ label, value, positive = false }: { label: string; value: string; up?: boolean; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#0e1019]/55 p-3">
      <div className="text-[11px] font-bold text-white/55">{label}</div>
      <div className={'mt-1 font-extrabold text-base ' + (positive ? 'text-emerald-400' : 'text-white')}>
        {value}
      </div>
    </div>
  )
}

function MetricCard({ num, label }: { num: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a0c14]/55 p-5 text-center shadow-[0_16px_46px_rgba(0,0,0,.22)]">
      <p
        className="m-0 text-[44px] font-black tracking-tight bg-clip-text text-transparent"
        style={{ backgroundImage: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}
      >
        {num}
      </p>
      <p className="mt-1 text-sm font-bold text-white/65">{label}</p>
    </div>
  )
}

function MarketCard({
  icon, title, desc, tag, tagColor,
}: { icon: React.ReactNode; title: string; desc: string; tag: string; tagColor: string }) {
  return (
    <div
      className="group relative rounded-2xl border border-white/10 bg-[#0a0c14]/45 p-5 transition-all cursor-default
                 hover:-translate-y-1.5 hover:border-[#3080ff]/40 hover:shadow-[0_24px_64px_rgba(48,128,255,.25)]"
    >
      <div
        className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-white/10 bg-white/5 text-white"
        style={{ color: tagColor }}
      >
        {icon}
      </div>
      <h3 className="mt-3 font-black text-base">{title}</h3>
      <p className="mt-1 text-[13px] text-white/65 leading-relaxed">{desc}</p>
      <span
        className="mt-3 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
        style={{ color: tagColor, background: `${tagColor}1f`, border: `1px solid ${tagColor}40` }}
      >
        {tag}
      </span>
    </div>
  )
}

function StepCard({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a0c14]/45 p-5">
      <div
        className="inline-flex items-center justify-center w-9 h-9 rounded-xl font-black text-white"
        style={{ background: 'linear-gradient(135deg, #3080ff, #22d3ee)' }}
      >
        {n}
      </div>
      <h3 className="mt-3 font-black text-base">{title}</h3>
      <p className="mt-1 text-[13px] text-white/65 leading-relaxed">{desc}</p>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-[#0a0c14]/45 p-5 transition-all cursor-default min-h-[170px]
                 hover:-translate-y-2 hover:scale-[1.015] hover:border-[#3080ff]/40 hover:shadow-[0_24px_64px_rgba(48,128,255,.30)]"
    >
      <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-white/12 bg-white/5 text-[#22d3ee]">
        {icon}
      </div>
      <h3 className="mt-3 font-black text-base">{title}</h3>
      <p className="mt-1 text-[13px] text-white/65 leading-relaxed">{desc}</p>
    </div>
  )
}

function TestimonialCard({ initials, color, name, role, quote }: {
  initials: string; color: string; name: string; role: string; quote: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a0c14]/55 p-5 transition-all min-h-[220px] flex flex-col gap-3
                    hover:-translate-y-1.5 hover:shadow-[0_24px_56px_rgba(34,211,238,.22)]">
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center font-black text-white border-2 border-white/10"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}
        >
          {initials}
        </div>
        <div>
          <div className="font-black text-white text-sm">{name}</div>
          <div className="text-xs text-white/55 font-semibold">{role}</div>
        </div>
      </div>
      <p className="text-[13px] text-white/70 leading-relaxed flex-1">"{quote}"</p>
      <div className="flex gap-0.5 text-yellow-400 text-sm">
        <Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" /><Star size={14} fill="currentColor" />
      </div>
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-white/[.03] open:bg-white/[.05] transition-colors">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-4 font-bold text-white text-[14px]">
        <span>{q}</span>
        <ChevronDown size={18} className="text-white/55 transition-transform group-open:rotate-180" />
      </summary>
      <p className="px-4 pb-4 -mt-1 text-[13px] text-white/65 leading-relaxed">{a}</p>
    </details>
  )
}

// Small icon for the Crypto market card (lucide doesn't ship a bitcoin/coin
// vibe that matches the others' weight — inline SVG fits the line-icon style).
function Coin() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={9} />
      <path d="M9 8h5a2.5 2.5 0 010 5H9V8zm0 5h6a2.5 2.5 0 010 5H9v-5z" />
    </svg>
  )
}
