// Testes do "Testar credenciais" do admin.
//
// O teste que mais importa aqui e' o do FALSO NEGATIVO. A sonda pede de
// proposito um recurso inexistente; a pergunta nao e' "achou?" e sim "o
// gateway aceitou minha credencial?". A primeira versao exigia 404 e, como
// a SkalaPay responde outro status, o admin acusou SKALAPAY_REQUEST_FAILED
// num gateway que estava processando depositos reais no mesmo minuto.
//
// Se alguem voltar a amarrar a sonda a um status especifico, o teste
// "status inesperado ... nao e' falha de credencial" quebra.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const getCashinStatus = vi.fn()
const getCharge       = vi.fn()
const pingAuth        = vi.fn()

vi.mock('../settings/service.js', () => ({ getSettings: () => ({ depositGateway: 'bspay' }) }))
vi.mock('./bspay.js', () => ({
  isConfigured: () => true,
  pingAuth:     (...a: any[]) => pingAuth(...a),
  createCashin: vi.fn(),
}))
vi.mock('./versell.js', () => ({
  isConfigured: () => true,
  getCharge:    (...a: any[]) => getCharge(...a),
  createCharge: vi.fn(),
}))
vi.mock('./skalapay.js', () => ({
  isConfigured:    () => true,
  getCashinStatus: (...a: any[]) => getCashinStatus(...a),
  createCashin:    vi.fn(),
}))

const { testGatewayCredentials } = await import('./gateway.js')

/** Erro no formato que os clientes de gateway lancam. */
function erro(code: string, httpStatus?: number) {
  return Object.assign(new Error(code), { code, httpStatus })
}

describe('testGatewayCredentials', () => {
  beforeEach(() => {
    pingAuth.mockReset().mockResolvedValue(undefined)
    getCharge.mockReset()
    getCashinStatus.mockReset()
  })

  afterEach(() => vi.clearAllMocks())

  it('bspay: token emitido -> ok', async () => {
    const r = await testGatewayCredentials('bspay')
    expect(r).toMatchObject({ gateway: 'bspay', ok: true, code: 'OK' })
  })

  it('skalapay: 404 no id inexistente -> credencial aceita', async () => {
    getCashinStatus.mockRejectedValue(erro('SKALAPAY_REQUEST_FAILED', 404))
    const r = await testGatewayCredentials('skalapay')
    expect(r).toMatchObject({ ok: true, code: 'OK' })
  })

  // O caso real de producao.
  it('skalapay: status inesperado (500) nao e falha de credencial', async () => {
    getCashinStatus.mockRejectedValue(erro('SKALAPAY_REQUEST_FAILED', 500))
    const r = await testGatewayCredentials('skalapay')
    expect(r).toMatchObject({ ok: true, code: 'OK' })
  })

  it('skalapay: 422 tambem passa', async () => {
    getCashinStatus.mockRejectedValue(erro('SKALAPAY_REQUEST_FAILED', 422))
    expect(await testGatewayCredentials('skalapay')).toMatchObject({ ok: true })
  })

  it('skalapay: 401 e credencial recusada', async () => {
    getCashinStatus.mockRejectedValue(erro('SKALAPAY_UNAUTHORIZED', 401))
    const r = await testGatewayCredentials('skalapay')
    expect(r).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
  })

  it('skalapay: 403 e credencial recusada', async () => {
    getCashinStatus.mockRejectedValue(erro('SKALAPAY_REQUEST_FAILED', 403))
    expect(await testGatewayCredentials('skalapay')).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
  })

  it('skalapay: timeout nao vira "credencial ok"', async () => {
    getCashinStatus.mockRejectedValue(erro('SKALAPAY_TIMEOUT'))
    const r = await testGatewayCredentials('skalapay')
    expect(r).toMatchObject({ ok: false, code: 'TIMEOUT' })
  })

  it('skalapay: falha de rede nao vira "credencial ok"', async () => {
    getCashinStatus.mockRejectedValue(erro('SKALAPAY_NETWORK_ERROR'))
    expect(await testGatewayCredentials('skalapay')).toMatchObject({ ok: false, code: 'NETWORK_ERROR' })
  })

  it('versell: 404 no txid inexistente -> credencial e mTLS ok', async () => {
    getCharge.mockRejectedValue(erro('VERSELL_NOT_FOUND', 404))
    expect(await testGatewayCredentials('versell')).toMatchObject({ ok: true, code: 'OK' })
  })

  it('versell: mTLS quebrado nao passa', async () => {
    getCharge.mockRejectedValue(erro('VERSELL_MTLS_FAILED'))
    expect(await testGatewayCredentials('versell')).toMatchObject({ ok: false, code: 'NETWORK_ERROR' })
  })

  it('erro sem classificacao carrega o HTTP na mensagem', async () => {
    pingAuth.mockRejectedValue(erro('BSPAY_WEIRD', 418))
    const r = await testGatewayCredentials('bspay')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('418')
  })
})
