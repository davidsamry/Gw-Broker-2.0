import { describe, expect, it } from 'vitest'
import { alignExpirationToSlotClose, DEFAULT_MIN_TIME_MS } from './expiration.js'

// Build a fixed epoch base for deterministic tests. Picking a Unix
// timestamp that lands exactly on a minute boundary avoids any timezone
// drift in the math. Tests below assume DEFAULT_MIN_TIME_MS = 29_000.
const BASE_MS = new Date('2026-01-01T12:00:00.000Z').getTime()

describe('alignExpirationToSlotClose — M1 (60s)', () => {
  it('clique no segundo 0 do minuto → pula (msUntil=0 < 29s) → expira em 60s', () => {
    const result = alignExpirationToSlotClose(BASE_MS, 60)
    expect(result.getTime() - BASE_MS).toBe(60_000)
  })

  it('clique no segundo 5 → expira no próximo close (55s depois)', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 5_000, 60)
    expect(result.getTime() - (BASE_MS + 5_000)).toBe(55_000)
  })

  it('clique no segundo 30 → expira no próximo close (30s depois)', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 30_000, 60)
    expect(result.getTime() - (BASE_MS + 30_000)).toBe(30_000)
  })

  it('clique no segundo 31 → faltam 29s (exatamente o mínimo), expira em 29s', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 31_000, 60)
    expect(result.getTime() - (BASE_MS + 31_000)).toBe(29_000)
  })

  it('clique no segundo 32 → faltam 28s (< 29s mínimo), pula pro seguinte (88s)', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 32_000, 60)
    expect(result.getTime() - (BASE_MS + 32_000)).toBe(88_000)
  })

  it('clique no segundo 45 → faltam 15s, pula pro seguinte (75s)', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 45_000, 60)
    expect(result.getTime() - (BASE_MS + 45_000)).toBe(75_000)
  })

  it('clique no segundo 59 → faltam 1s, pula pro seguinte (61s)', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 59_000, 60)
    expect(result.getTime() - (BASE_MS + 59_000)).toBe(61_000)
  })
})

describe('alignExpirationToSlotClose — M5 (300s)', () => {
  it('clique no segundo 0 → pula (msUntil=0 < 29s) → expira em 300s', () => {
    expect(alignExpirationToSlotClose(BASE_MS, 300).getTime() - BASE_MS).toBe(300_000)
  })

  it('clique no minuto 2 do M5 → expira em 180s', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 120_000, 300)
    expect(result.getTime() - (BASE_MS + 120_000)).toBe(180_000)
  })

  it('clique 28s antes do close M5 → pula pro próximo (328s)', () => {
    const result = alignExpirationToSlotClose(BASE_MS + (300_000 - 28_000), 300)
    expect(result.getTime() - (BASE_MS + 272_000)).toBe(328_000)
  })
})

describe('alignExpirationToSlotClose — M15 (900s)', () => {
  it('clique no segundo 0 → pula (msUntil=0 < 29s) → expira em 900s', () => {
    expect(alignExpirationToSlotClose(BASE_MS, 900).getTime() - BASE_MS).toBe(900_000)
  })

  it('clique no minuto 12 do M15 → expira em 3min', () => {
    const result = alignExpirationToSlotClose(BASE_MS + 12 * 60_000, 900)
    expect(result.getTime() - (BASE_MS + 720_000)).toBe(180_000)
  })
})

describe('alignExpirationToSlotClose — guarantees', () => {
  it('expiração sempre cai num multiplo do timeframe (alignment)', () => {
    for (let offsetSec = 0; offsetSec < 60; offsetSec++) {
      const result = alignExpirationToSlotClose(BASE_MS + offsetSec * 1000, 60)
      expect(result.getTime() % 60_000).toBe(0)
    }
  })

  it('op nunca dura menos que minTimeMs', () => {
    for (let offsetSec = 0; offsetSec < 60; offsetSec++) {
      const nowMs = BASE_MS + offsetSec * 1000
      const result = alignExpirationToSlotClose(nowMs, 60)
      expect(result.getTime() - nowMs).toBeGreaterThanOrEqual(DEFAULT_MIN_TIME_MS)
    }
  })

  it('op nunca dura mais que timeframe + minTimeMs', () => {
    for (let offsetSec = 0; offsetSec < 60; offsetSec++) {
      const nowMs = BASE_MS + offsetSec * 1000
      const result = alignExpirationToSlotClose(nowMs, 60)
      expect(result.getTime() - nowMs).toBeLessThanOrEqual(60_000 + DEFAULT_MIN_TIME_MS)
    }
  })

  it('minTimeMs customizado é respeitado', () => {
    // minTimeMs = 0 → SEMPRE o próximo close, mesmo se for em 1ms
    const result = alignExpirationToSlotClose(BASE_MS + 59_999, 60, 0)
    expect(result.getTime() - (BASE_MS + 59_999)).toBe(1)
  })
})
