// Testes do cliente SkalaPay.
//
// Foco: parsing defensivo da resposta (o provedor pode mexer no formato),
// classificação de erro e — o mais importante — garantir que credencial
// nunca vaza em mensagem de erro, já que elas viajam em header a cada
// request.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  isConfigured, normalizeStatus, createCashin, getCashinStatus,
  createCashout, SkalaPayError,
} from './skalapay.js'

const ID     = 'client-id-de-teste'
const SECRET = 'client-secret-de-teste-nao-vazar'

function resposta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const COBRANCA_OK = {
  transaction: {
    id:       1420,
    order_id: 'CASHIN_abc123',
    status:   'PENDING',
    acquirer_response: {
      qr_code:        '00020101021226...6304ABCD',
      qr_code_base64: 'iVBORw0KGgo=',
      expires_at:     '2026-11-06T21:00:00Z',
    },
  },
}

const ENTRADA = {
  amount:      '100.00',
  description: 'Deposito VX Global #dep-1',
  customer:    { name: 'Fulano', email: 'fulano@exemplo.com', document: '12345678909' },
}

describe('cliente SkalaPay', () => {
  const ORIG = { ...process.env }

  beforeEach(() => {
    process.env.SKALAPAY_CLIENT_ID     = ID
    process.env.SKALAPAY_CLIENT_SECRET = SECRET
    delete process.env.SKALAPAY_BASE_URL
  })

  afterEach(() => {
    process.env = { ...ORIG }
    vi.unstubAllGlobals()
  })

  it('isConfigured depende das duas credenciais', () => {
    expect(isConfigured()).toBe(true)
    delete process.env.SKALAPAY_CLIENT_SECRET
    expect(isConfigured()).toBe(false)
  })

  it('sem credencial falha antes de qualquer chamada HTTP', async () => {
    delete process.env.SKALAPAY_CLIENT_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createCashin(ENTRADA)).rejects.toMatchObject({ code: 'SKALAPAY_NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('manda as credenciais em header e devolve o copia-e-cola', async () => {
    const fetchMock = vi.fn(async () => resposta(COBRANCA_OK))
    vi.stubGlobal('fetch', fetchMock)

    const r = await createCashin(ENTRADA)

    expect(r.transactionId).toBe('1420')
    expect(r.orderId).toBe('CASHIN_abc123')
    expect(r.qrcode).toBe('00020101021226...6304ABCD')
    expect(r.qrcodeBase64).toBe('iVBORw0KGgo=')
    expect(r.status).toBe('PENDING')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://skalapay.net/api/cash-in')
    expect((init.headers as Record<string, string>)['X-Client-Id']).toBe(ID)
    expect((init.headers as Record<string, string>)['X-Client-Secret']).toBe(SECRET)
    const enviado = JSON.parse(init.body as string)
    expect(enviado.payment_method).toBe('pix')
    expect(enviado.amount).toBe(100)
    expect(enviado.customer_data.document).toBe('12345678909')
  })

  it('resposta sem copia-e-cola falha em vez de devolver QR vazio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta({
      transaction: { id: 9, status: 'PENDING', acquirer_response: {} },
    })))
    await expect(createCashin(ENTRADA)).rejects.toMatchObject({ code: 'SKALAPAY_MISSING_QRCODE' })
  })

  it('resposta sem id falha — sem id nao daria pra reconciliar o webhook', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta({
      transaction: { status: 'PENDING', acquirer_response: { qr_code: '000201...' } },
    })))
    await expect(createCashin(ENTRADA)).rejects.toMatchObject({
      code: 'SKALAPAY_MISSING_TRANSACTION_ID',
    })
  })

  it('401 vira SKALAPAY_UNAUTHORIZED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('credencial invalida', { status: 401 })))
    await expect(createCashin(ENTRADA)).rejects.toMatchObject({
      code: 'SKALAPAY_UNAUTHORIZED', httpStatus: 401,
    })
  })

  it('timeout vira SKALAPAY_TIMEOUT', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('abortado por timeout'); e.name = 'TimeoutError'; throw e
    }))
    await expect(createCashin(ENTRADA)).rejects.toMatchObject({ code: 'SKALAPAY_TIMEOUT' })
  })

  it('o client-secret nunca aparece no erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro interno', { status: 500 })))

    let capturado: SkalaPayError | null = null
    try { await createCashin(ENTRADA) } catch (e: any) { capturado = e }

    const texto = JSON.stringify({
      message: capturado?.message, detail: capturado?.detail, stack: capturado?.stack,
    })
    expect(texto).not.toContain(SECRET)
    expect(texto).not.toContain(ID)
  })

  it('consulta de status aceita id e devolve valor pra conferencia', async () => {
    const fetchMock = vi.fn(async () => resposta({
      transaction: { id: 1420, order_id: 'CASHIN_x', status: 'paid', amount: '100.00', paid_at: '2026-11-06T20:00:00Z' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await getCashinStatus('1420')

    expect(r.status).toBe('PAID')      // minuscula normalizada
    expect(r.amount).toBe('100.00')
    expect(r.paidAt).toBeInstanceOf(Date)
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0])
      .toBe('https://skalapay.net/api/cash-in/1420')
  })

  it('cash-out devolve id e saldo restante', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta({
      success: true, message: 'Saque solicitado com sucesso.', transaction_id: 1425, balance: 850.0,
    })))

    const r = await createCashout({
      amount: '50.00', pixKey: '12345678909', pixKeyType: 'CPF', description: 'Saque',
    })

    expect(r.success).toBe(true)
    expect(r.transactionId).toBe('1425')
    expect(r.balance).toBe('850')
  })

  it('normalizeStatus cobre a tabela da doc e cai em UNKNOWN', () => {
    expect(normalizeStatus('paid')).toBe('PAID')
    expect(normalizeStatus('CHARGEBACK')).toBe('CHARGEBACK')
    expect(normalizeStatus('coisa_nova')).toBe('UNKNOWN')
    expect(normalizeStatus(undefined)).toBe('UNKNOWN')
  })
})
