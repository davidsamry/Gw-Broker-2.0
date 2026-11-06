// Testes do webhook SkalaPay.
//
// O teste que mais importa aqui é o do webhook FORJADO. A SkalaPay não
// assina o webhook de jeito nenhum, então a única coisa que separa um
// pagamento real de um POST falso é a reconsulta à API deles. Se alguém
// algum dia remover essa reconsulta "pra ficar mais rápido", o teste
// "webhook forjado" quebra.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const SECRET = 'segredo-de-path-pra-teste'

const confirmDepositById = vi.fn(async () => true)
const getCashinStatus    = vi.fn()
const queryRaw           = vi.fn()

vi.mock('../prisma.js', () => ({ prisma: { $queryRaw: (...a: any[]) => queryRaw(...a) } }))
vi.mock('../deposits/service.js', () => ({ confirmDepositById: (...a: any[]) => confirmDepositById(...a) }))
vi.mock('../payments/skalapay.js', () => ({ getCashinStatus: (...a: any[]) => getCashinStatus(...a) }))

const { skalapayWebhookRoutes } = await import('./skalapay.js')

const DEPOSITO = { id: 'dep-uuid-1', status: 'PENDING', amount: '100.00' }

const PAGO = {
  event:          'cashin.confirmed',
  status:         'paid',
  transaction_id: 1420,
  order_id:       'CASHIN_abc',
  amount:         '100.00',
  paid_at:        '2026-11-06T20:00:00Z',
}

async function montarApp() {
  const app = Fastify({ logger: false })
  await app.register(skalapayWebhookRoutes, { prefix: '/webhooks' })
  return app
}

function post(app: any, secret: string, payload: unknown) {
  return app.inject({ method: 'POST', url: `/webhooks/skalapay/${secret}`, payload })
}

describe('webhook SkalaPay', () => {
  const ORIG = { ...process.env }

  beforeEach(() => {
    process.env.SKALAPAY_WEBHOOK_SECRET = SECRET
    confirmDepositById.mockClear().mockResolvedValue(true)
    getCashinStatus.mockReset()
    queryRaw.mockReset().mockResolvedValue([DEPOSITO])
  })

  afterEach(() => { process.env = { ...ORIG } })

  it('segredo errado no path → 404, sem tocar no banco', async () => {
    const app = await montarApp()
    const res = await post(app, 'segredo-errado', PAGO)

    expect(res.statusCode).toBe(404)
    expect(queryRaw).not.toHaveBeenCalled()
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('sem SKALAPAY_WEBHOOK_SECRET configurado → 404 (nao abre sozinho)', async () => {
    delete process.env.SKALAPAY_WEBHOOK_SECRET
    const app = await montarApp()
    const res = await post(app, SECRET, PAGO)

    expect(res.statusCode).toBe(404)
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('WEBHOOK FORJADO: diz pago, mas a API diz PENDING → nao credita', async () => {
    getCashinStatus.mockResolvedValue({ status: 'PENDING', amount: '100.00' })
    const app = await montarApp()

    const res = await post(app, SECRET, PAGO)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ acted: false })
    expect(getCashinStatus).toHaveBeenCalledWith('1420')
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('pagamento real (API confirma PAID e valor bate) → credita', async () => {
    getCashinStatus.mockResolvedValue({ status: 'PAID', amount: '100.00' })
    const app = await montarApp()

    const res = await post(app, SECRET, PAGO)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ received: true, acted: true })
    expect(confirmDepositById).toHaveBeenCalledWith('dep-uuid-1')
  })

  it('valor divergente do nosso registro → bloqueia o credito', async () => {
    getCashinStatus.mockResolvedValue({ status: 'PAID', amount: '5000.00' })
    const app = await montarApp()

    const res = await post(app, SECRET, PAGO)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ acted: false })
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('reconsulta indisponivel → 500 pra SkalaPay reenviar, sem creditar', async () => {
    getCashinStatus.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'SKALAPAY_TIMEOUT' }))
    const app = await montarApp()

    const res = await post(app, SECRET, PAGO)

    expect(res.statusCode).toBe(500)
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('deposito ja PAID → idempotente, nao reconsulta nem credita de novo', async () => {
    queryRaw.mockResolvedValue([{ ...DEPOSITO, status: 'PAID' }])
    const app = await montarApp()

    const res = await post(app, SECRET, PAGO)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ acted: false })
    expect(getCashinStatus).not.toHaveBeenCalled()
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('transacao sem deposito correspondente → 200 sem retry infinito', async () => {
    queryRaw.mockResolvedValue([])
    const app = await montarApp()

    const res = await post(app, SECRET, PAGO)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ acted: false })
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('evento que nao e confirmacao → 200 sem reconsultar nada', async () => {
    const app = await montarApp()

    const res = await post(app, SECRET, { event: 'cashin.created', status: 'pending', transaction_id: 1420 })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ acted: false })
    expect(getCashinStatus).not.toHaveBeenCalled()
    expect(confirmDepositById).not.toHaveBeenCalled()
  })

  it('confirmacao sem identificador → 200 sem acao', async () => {
    const app = await montarApp()

    const res = await post(app, SECRET, { event: 'cashin.confirmed', status: 'paid' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ acted: false })
    expect(queryRaw).not.toHaveBeenCalled()
  })
})
