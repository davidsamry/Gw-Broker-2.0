// Sons da plataforma — notificações de feedback ao usuário durante o
// fluxo de operação.
//
//   open  → tocado quando o user abre uma operação (clique em Para
//           Cima/Baixo); reforça o feedback visual otimista do marker.
//   win   → tocado quando o card de resultado verde aparece no chart.
//   loss  → tocado quando o card de resultado vermelho aparece no chart.
//
// Decisões:
//   - HTMLAudioElement vs Web Audio API: HTMLAudioElement basta (sons
//     curtos, sem mixagem complexa); fica mais simples e leve.
//   - Preload "auto" no primeiro uso para evitar latência no clique.
//     Não é "auto" no construtor pra não bloquear o paint inicial; só
//     vira "auto" depois que playSound roda pela primeira vez.
//   - Volume 0.5 — alto o bastante pra ouvir em mobile sem fone, baixo
//     o bastante pra não estourar.
//   - Autoplay policy: navegadores bloqueiam audio sem gesture. Como
//     'open' SEMPRE acontece via clique (gesture do user), ele
//     desbloqueia o context. 'win' e 'loss' que vêm via timer/SSE
//     depois usam o mesmo elemento já desbloqueado → tocam OK.
//   - Toggle: persistido em localStorage como vx:sound_enabled
//     (default true). Sem UI ainda — usuário pode desabilitar via
//     console se quiser: localStorage.setItem('vx:sound_enabled','false').
//   - Dedupe: cada op tem um id; um Set guarda os ids que já tocaram
//     win/loss pra prevenir duplo som quando o evento "resolved" vem
//     simultaneamente por 2 fontes (GET local + SSE store).
//   - Falha silenciosa: qualquer erro de play() (autoplay block, file
//     missing, etc) é capturado e ignorado — som é nice-to-have, nunca
//     deve quebrar o fluxo de trade.

export type SoundName = 'open' | 'win' | 'loss'

const STORAGE_KEY = 'vx:sound_enabled'
const FILES: Record<SoundName, string> = {
  open: '/sounds/open.mp3',
  win:  '/sounds/win.mp3',
  loss: '/sounds/loss.mp3',
}

// Cache do HTMLAudioElement por som. Reutiliza o mesmo elemento pra
// evitar criar dezenas a cada minuto. Reset .currentTime = 0 antes de
// cada play (caso ainda esteja tocando do trigger anterior).
const audioCache: Partial<Record<SoundName, HTMLAudioElement>> = {}

// Set de ids de op que já tocaram win/loss — dedupe entre as 2 fontes
// (TradingPanel.handleTradePlaced após GET + page.tsx useEffect após SSE).
const playedResolveIds = new Set<string>()

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function getOrCreate(name: SoundName): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  let el = audioCache[name]
  if (!el) {
    try {
      el = new Audio(FILES[name])
      el.preload = 'auto'
      el.volume  = 0.5
      audioCache[name] = el
    } catch {
      return null
    }
  }
  return el
}

/**
 * Toca o som imediatamente. Idempotente e seguro — qualquer falha é
 * silenciosa. Use playResolveSound (com id) pra win/loss para evitar
 * duplo som quando o evento chega de 2 fontes.
 */
export function playSound(name: SoundName): void {
  if (!isEnabled()) return
  const el = getOrCreate(name)
  if (!el) return
  try {
    el.currentTime = 0
    // play() retorna Promise — pode rejeitar por autoplay policy.
    // O .catch silencioso evita unhandled rejection sem afetar o fluxo.
    el.play().catch(() => { /* silenced — autoplay or missing file */ })
  } catch { /* silenced — element disposed mid-play, etc */ }
}

/**
 * Wrapper de playSound pra win/loss com dedupe por id da operação.
 * Garante que cada op toque o som EXATAMENTE UMA vez, mesmo que o
 * RESOLVED chegue por múltiplas fontes (GET pós-expiração + SSE).
 */
export function playResolveSound(opId: string, won: boolean): void {
  if (playedResolveIds.has(opId)) return
  playedResolveIds.add(opId)
  // Bound do Set pra não crescer infinitamente. 200 entries cobre
  // várias horas de trading; ao passar, dropa a mais antiga.
  if (playedResolveIds.size > 200) {
    const first = playedResolveIds.values().next().value
    if (first) playedResolveIds.delete(first)
  }
  playSound(won ? 'win' : 'loss')
}

/** Liga/desliga via JS (sem UI ainda). Persiste em localStorage. */
export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false') }
  catch { /* quota / disabled */ }
}
