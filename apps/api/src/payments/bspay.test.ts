// Testes do cliente BSPay — foco no caminho do token OAuth.
//
// Por que isso existe: em 06/11/2026, 20 das 71 falhas historicas de deposito
// foram timeout de exatos 10,0s no /oauth/token. A chamada nao tinha retry e
// rodava dentro do request do usuario, entao uma oscilacao do gateway matava
// o deposito de quem tivesse o azar de ser o primeiro depois da expiracao.
//
// Estes testes travam o comportamento novo: retry so em falha transitoria,
// cache reaproveitado, e uma renovacao so quando varios depositos chegam
// juntos.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const TOKEN_URL  = '/v2/oauth/token'
const CASHIN_URL = '/v2/transactions/cashin'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function timeoutError(): Error {
  // E assim que AbortSignal.timeout() falha: DOMException name='TimeoutError'.
  const err = new Error('The operation was aborted due to timeout')
  err.name = 'TimeoutError'
  return err
}

/**
 * Mock de fetch que responde por URL (e nao por ordem de chamada) e conta
 * quantas vezes cada endpoint foi chamado.
 */
function mockFetch(opts: {
  tokenFails?: number                  // quantas chamadas de token falham antes de dar certo
  tokenStatus?: number                 // status HTTP do token (default 200)
  tokenExpiresIn?: number              // segundos de validade (default 3600)
} = {}) {
  const contagem = { token: 0, cashin: 0 }
  const falhasRestantes = { n: opts.tokenFails ?? 0 }

  const fn = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes(TOKEN_URL)) {
      contagem.token++
      if (falhasRestantes.n > 0) { falhasRestantes.n--; throw timeoutError() }
      if (opts.tokenStatus && opts.tokenStatus !== 200) {
        return new Response('credencial invalida', { status: opts.tokenStatus })
      }
      return jsonResponse({ access_token: `tok-${contagem.token}`, expires_in: opts.tokenExpiresIn ?? 3600 })
    }
    if (u.includes(CASHIN_URL)) {
      contagem.cashin++
      return jsonResponse({ data: { payment_info: { qrcode: 'BRCODE-000' }, transaction_id: `tx-${contagem.cashin}` } })
    }
    throw new Error(`URL inesperada no teste: ${u}`)
  })

  vi.stubGlobal('fetch', fn)
  return contagem
}

/** Modulo novo a cada teste — o cache de token e estado de modulo. */
async function carregarClienteLimpo() {
  vi.resetModules()
  return import('./bspay.js')
}

const COBRANCA = { amount: 100, externalId: 'dep-1', postbackUrl: 'https://api.exemplo.com/hook' }

describe('cliente BSPay — token OAuth', () => {
  const ORIG_ENV = { ...process.env }

  beforeEach(() => {
    process.env.BSPAY_CLIENT_ID     = 'id-de-teste'
    process.env.BSPAY_CLIENT_SECRET = 'segredo-de-teste'
  })

  afterEach(() => {
    process.env = { ...ORIG_ENV }
    vi.unstubAllGlobals()
  })

  it('timeout no token e tentado mais uma vez, e o deposito passa', async () => {
    const n = mockFetch({ tokenFails: 1 })
    const { createCashin } = await carregarClienteLimpo()

    const res = await createCashin(COBRANCA)

    expect(res.qrcode).toBe('BRCODE-000')
    expect(n.token).toBe(2)    // falhou uma, acertou na segunda
    expect(n.cashin).toBe(1)
  })

  it('timeout nas duas tentativas propaga o erro (nao mascara falha real)', async () => {
    const n = mockFetch({ tokenFails: 2 })
    const { createCashin } = await carregarClienteLimpo()

    await expect(createCashin(COBRANCA)).rejects.toThrow(/timeout/i)
    expect(n.token).toBe(2)    // exatamente 2: uma original + uma extra
    expect(n.cashin).toBe(0)   // nunca chegou a criar cobranca
  })

  it('5xx do gateway e tentado de novo (erro passageiro do lado deles)', async () => {
    // Regressao: o teste de transitorio usa regex sobre a mensagem do erro.
    // Se a classe d quebrar, 5xx deixa de ser reconhecido como passageiro
    // e o retry some sem ninguem perceber.
    let chamadas = 0
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes(TOKEN_URL)) {
        chamadas++
        if (chamadas === 1) return new Response('indisponivel', { status: 503 })
        return jsonResponse({ access_token: 'tok-ok', expires_in: 3600 })
      }
      return jsonResponse({ data: { payment_info: { qrcode: 'BRCODE-000' }, transaction_id: 'tx-1' } })
    }))
    const { createCashin } = await carregarClienteLimpo()

    const res = await createCashin(COBRANCA)

    expect(res.qrcode).toBe('BRCODE-000')
    expect(chamadas).toBe(2)
  })

  it('credencial errada (401) NAO e tentada de novo', async () => {
    const n = mockFetch({ tokenStatus: 401 })
    const { createCashin } = await carregarClienteLimpo()

    await expect(createCashin(COBRANCA)).rejects.toThrow(/BSPAY_AUTH_FAILED:401/)
    expect(n.token).toBe(1)    // repetir nao resolveria — nao insiste
  })

  it('token valido e reaproveitado entre depositos', async () => {
    const n = mockFetch()
    const { createCashin } = await carregarClienteLimpo()

    await createCashin({ ...COBRANCA, externalId: 'dep-1' })
    await createCashin({ ...COBRANCA, externalId: 'dep-2' })
    await createCashin({ ...COBRANCA, externalId: 'dep-3' })

    expect(n.token).toBe(1)
    expect(n.cashin).toBe(3)
  })

  it('depositos simultaneos compartilham uma renovacao so (single-flight)', async () => {
    const n = mockFetch()
    const { createCashin } = await carregarClienteLimpo()

    await Promise.all([
      createCashin({ ...COBRANCA, externalId: 'dep-a' }),
      createCashin({ ...COBRANCA, externalId: 'dep-b' }),
      createCashin({ ...COBRANCA, externalId: 'dep-c' }),
    ])

    expect(n.token).toBe(1)    // sem single-flight seriam 3
    expect(n.cashin).toBe(3)
  })

  it('token quase vencido e renovado em background, sem travar o deposito', async () => {
    // expires_in curto o bastante pra cair na janela de renovacao (5 min),
    // mas acima do limite duro de 30s — entao a chamada devolve o token
    // atual na hora e dispara a renovacao por fora.
    const n = mockFetch({ tokenExpiresIn: 120 })
    const { createCashin } = await carregarClienteLimpo()

    await createCashin({ ...COBRANCA, externalId: 'dep-1' })
    expect(n.token).toBe(1)

    await createCashin({ ...COBRANCA, externalId: 'dep-2' })
    // Pediu token novo em background — mas o segundo deposito nao esperou
    // por ele: foram 2 cashins, nenhum bloqueado.
    await vi.waitFor(() => expect(n.token).toBe(2))
    expect(n.cashin).toBe(2)
  })

  it('sem credencial configurada, falha limpo antes de qualquer chamada', async () => {
    delete process.env.BSPAY_CLIENT_ID
    const n = mockFetch()
    const { createCashin } = await carregarClienteLimpo()

    await expect(createCashin(COBRANCA)).rejects.toThrow('BSPAY_NOT_CONFIGURED')
    expect(n.token).toBe(0)
  })
})
