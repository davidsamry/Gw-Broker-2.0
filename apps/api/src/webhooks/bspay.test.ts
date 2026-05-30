// Smoke tests pra Sec O2.3 — valida que:
//  (1) path-secret errado → 404
//  (2) path-secret certo, HMAC env nao setada → aceita (legacy mode)
//  (3) HMAC ativo, sem headers → 401
//  (4) HMAC ativo, timestamp velho → 401
//  (5) HMAC ativo, assinatura errada → 401
//  (6) HMAC ativo, tudo certo → 200
//
// Nao mocka o Postgres — usa um stub do confirmDepositById passando
// um external_id que nao existe (devolve { acted: false } sem tocar DB).

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import crypto from 'node:crypto'
import { bspayWebhookRoutes } from './bspay.js'

// Stub: substitui confirmDepositById pra nao depender de DB. O test
// nao precisa validar a logica de deposit — so a assinatura.
vi.mock('../deposits/service.js', () => ({
  confirmDepositById: vi.fn(async () => ({ id: 'fake', deposit: {}, account: {} })),
}))

const PATH_SECRET = 'path-secret-for-tests'
const HMAC_SECRET = 'hmac-secret-for-tests-32-chars-min'

function makeSignature(rawBody: string, ts: number, secret: string): string {
  // BSPay assina o body raw (nao concatena timestamp). Timestamp vai em
  // header separado X-Webhook-Timestamp.
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(bspayWebhookRoutes, { prefix: '/webhooks' })
  return app
}

describe('bspay webhook — Sec O2.3', () => {
  const ORIG_ENV = { ...process.env }

  beforeEach(() => {
    process.env.BSPAY_WEBHOOK_SECRET = PATH_SECRET
    delete process.env.BSPAY_WEBHOOK_HMAC_SECRET
  })

  afterEach(() => {
    process.env = { ...ORIG_ENV }
  })

  it('(1) path-secret errado → 404', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method:  'POST',
      url:     '/webhooks/bspay/wrong-secret',
      headers: { 'content-type': 'application/json' },
      payload: { event: 'cashin.confirmed', external_id: 'X' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('(2) path-secret certo, HMAC env nao setada → aceita (legacy)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method:  'POST',
      url:     `/webhooks/bspay/${PATH_SECRET}`,
      headers: { 'content-type': 'application/json' },
      payload: { event: 'ignored', external_id: 'X' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, acted: false })
    await app.close()
  })

  it('(3) HMAC ativo, headers ausentes → 401 MISSING_SIGNATURE', async () => {
    process.env.BSPAY_WEBHOOK_HMAC_SECRET = HMAC_SECRET
    const app = await buildApp()
    const res = await app.inject({
      method:  'POST',
      url:     `/webhooks/bspay/${PATH_SECRET}`,
      headers: { 'content-type': 'application/json' },
      payload: { event: 'cashin.confirmed', external_id: 'X' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'MISSING_SIGNATURE' })
    await app.close()
  })

  it('(4) HMAC ativo, timestamp velho (>5min) → 401 STALE_SIGNATURE', async () => {
    process.env.BSPAY_WEBHOOK_HMAC_SECRET = HMAC_SECRET
    const app = await buildApp()
    const oldTs   = Math.floor(Date.now() / 1000) - 600  // 10 min atras
    const payload = { event: 'cashin.confirmed', external_id: 'X' }
    const raw     = JSON.stringify(payload)
    const sig     = makeSignature(raw, oldTs, HMAC_SECRET)
    const res = await app.inject({
      method:  'POST',
      url:     `/webhooks/bspay/${PATH_SECRET}`,
      headers: {
        'content-type':        'application/json',
        'x-webhook-timestamp': String(oldTs),
        'x-webhook-signature': sig,
      },
      payload: raw,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'STALE_SIGNATURE' })
    await app.close()
  })

  it('(5) HMAC ativo, assinatura errada → 401 INVALID_SIGNATURE', async () => {
    process.env.BSPAY_WEBHOOK_HMAC_SECRET = HMAC_SECRET
    const app = await buildApp()
    const ts      = Math.floor(Date.now() / 1000)
    const payload = { event: 'cashin.confirmed', external_id: 'X' }
    const raw     = JSON.stringify(payload)
    // Assinatura calculada com SECRET ERRADO
    const sig     = makeSignature(raw, ts, 'wrong-secret-different-length-than-real')
    const res = await app.inject({
      method:  'POST',
      url:     `/webhooks/bspay/${PATH_SECRET}`,
      headers: {
        'content-type':        'application/json',
        'x-webhook-timestamp': String(ts),
        'x-webhook-signature': sig,
      },
      payload: raw,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'INVALID_SIGNATURE' })
    await app.close()
  })

  it('(6) HMAC ativo, tudo certo → 200', async () => {
    process.env.BSPAY_WEBHOOK_HMAC_SECRET = HMAC_SECRET
    const app = await buildApp()
    const ts      = Math.floor(Date.now() / 1000)
    const payload = { event: 'ignored', external_id: 'X' }
    const raw     = JSON.stringify(payload)
    const sig     = makeSignature(raw, ts, HMAC_SECRET)
    const res = await app.inject({
      method:  'POST',
      url:     `/webhooks/bspay/${PATH_SECRET}`,
      headers: {
        'content-type':        'application/json',
        'x-webhook-timestamp': String(ts),
        'x-webhook-signature': sig,
      },
      payload: raw,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, acted: false })
    await app.close()
  })

  it('(7) timing-safe: path-secret de tamanho diferente nao crasha', async () => {
    const app = await buildApp()
    // Buffer.from('a').length !== Buffer.from(PATH_SECRET).length —
    // timingSafeEqual exigiria mesmo tamanho. Nosso wrapper retorna false.
    const res = await app.inject({
      method:  'POST',
      url:     '/webhooks/bspay/a',
      headers: { 'content-type': 'application/json' },
      payload: { event: 'cashin.confirmed', external_id: 'X' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
