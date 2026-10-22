// Guarda de sessão — derruba usuário bloqueado ou excluído que JÁ está
// logado.
//
// O bug (2026-10-22): `blocked` só era conferido no /auth/login. Quem já
// tinha sessão aberta continuava usando a plataforma normalmente, e o
// cookie de refresh (7 dias) renovava o access token indefinidamente —
// ou seja, bloquear um usuário não expulsava ninguém. Um usuário
// bloqueado seguiu acessando a conta e o histórico por dias.
//
// Agora o estado é conferido em dois pontos:
//   1. authenticate (todo request autenticado) — efeito imediato
//   2. /auth/refresh — impede o cookie de ressuscitar a sessão
//
// Cache de 30s pra não colocar um SELECT no caminho quente de cada
// request. O admin invalida explicitamente ao bloquear (invalidate()),
// então na prática o corte é instantâneo; o TTL é só a rede de segurança
// pra mudanças feitas direto no banco.
import { prisma } from '../prisma.js'

export type SessionState = 'OK' | 'BLOCKED' | 'DELETED' | 'NOT_FOUND'

const TTL_MS = 30_000
const cache = new Map<string, { state: SessionState; until: number }>()

export async function getSessionState(userId: string): Promise<SessionState> {
  const hit = cache.get(userId)
  const now = Date.now()
  if (hit && hit.until > now) return hit.state

  let state: SessionState = 'OK'
  try {
    const rows = await prisma.$queryRaw<Array<{ blocked: boolean; deletedAt: Date | null }>>`
      SELECT blocked, "deletedAt" FROM users WHERE id = ${userId} LIMIT 1
    `
    const u = rows[0]
    if (!u)                 state = 'NOT_FOUND'
    else if (u.deletedAt)   state = 'DELETED'
    else if (u.blocked)     state = 'BLOCKED'
  } catch (err) {
    // Falha de banco NÃO derruba sessão legítima — fail-open. O pior
    // caso é um bloqueado sobreviver mais 30s; o contrário (deslogar
    // todo mundo numa oscilação do banco) seria bem pior.
    console.error('[sessionGuard] consulta falhou — liberando por segurança', err)
    return 'OK'
  }

  cache.set(userId, { state, until: now + TTL_MS })
  return state
}

/** Chamado quando o admin bloqueia/desbloqueia ou a conta é excluída. */
export function invalidateSessionState(userId: string): void {
  cache.delete(userId)
}
