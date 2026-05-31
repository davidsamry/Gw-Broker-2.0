// Regression test pro bug do BigInt no audit log.
//
// O writeAuditLog chamava JSON.stringify direto, que quebra com
// "TypeError: Do not know how to serialize a BigInt" quando algum campo
// vinha como bigint (Prisma raw queries com COUNT(*) ou $executeRaw em
// algumas configs de driver).
//
// Os testes abaixo NAO mockam Prisma — testam so o replacer puro, que
// e' a unica logica nova. O comportamento de writeAuditLog em si
// (insert no DB) ja' e' coberto implicitamente pelo log de prod toda
// vez que admin abre um ticket / aprova saque / etc.

import { describe, expect, it } from 'vitest'
import { bigintSafeReplacer } from './service.js'

describe('bigintSafeReplacer — Fix audit log BigInt bug', () => {
  it('passa numbers normais inalterados', () => {
    const out = JSON.parse(JSON.stringify({ a: 1, b: 2.5, c: -3 }, bigintSafeReplacer))
    expect(out).toEqual({ a: 1, b: 2.5, c: -3 })
  })

  it('passa strings inalteradas', () => {
    const out = JSON.parse(JSON.stringify({ msg: 'hello', x: 'world' }, bigintSafeReplacer))
    expect(out).toEqual({ msg: 'hello', x: 'world' })
  })

  it('passa booleans + null + undefined inalterados', () => {
    const out = JSON.parse(JSON.stringify(
      { a: true, b: false, c: null /* undefined nao serializa */ },
      bigintSafeReplacer,
    ))
    expect(out).toEqual({ a: true, b: false, c: null })
  })

  it('bigint pequeno (< MAX_SAFE_INTEGER) vira Number', () => {
    const out = JSON.parse(JSON.stringify({ count: BigInt(42) }, bigintSafeReplacer))
    expect(out).toEqual({ count: 42 })
    expect(typeof out.count).toBe('number')
  })

  it('bigint zero vira Number 0', () => {
    const out = JSON.parse(JSON.stringify({ count: 0n }, bigintSafeReplacer))
    expect(out).toEqual({ count: 0 })
  })

  it('bigint negativo vira Number negativo', () => {
    const out = JSON.parse(JSON.stringify({ x: -100n }, bigintSafeReplacer))
    expect(out).toEqual({ x: -100 })
  })

  it('bigint MAX_SAFE_INTEGER vira Number sem perda', () => {
    const out = JSON.parse(JSON.stringify(
      { big: BigInt(Number.MAX_SAFE_INTEGER) },
      bigintSafeReplacer,
    ))
    expect(out).toEqual({ big: Number.MAX_SAFE_INTEGER })
  })

  it('bigint > MAX_SAFE_INTEGER vira string (preserva precisao)', () => {
    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n
    const out = JSON.parse(JSON.stringify({ huge: tooBig }, bigintSafeReplacer))
    expect(out).toEqual({ huge: tooBig.toString() })
    expect(typeof out.huge).toBe('string')
  })

  it('bigint nested em objetos profundos tambem e tratado', () => {
    const out = JSON.parse(JSON.stringify(
      { outer: { inner: { count: 5n }, list: [1n, 2n, 3n] } },
      bigintSafeReplacer,
    ))
    expect(out).toEqual({ outer: { inner: { count: 5 }, list: [1, 2, 3] } })
  })

  it('reproduz o cenario REAL que quebrava antes — counts de Prisma raw queries', () => {
    // Cenario do bug: fullResetAllOtc tinha algo tipo
    //   { snap: bigint, candles: bigint, ticks: bigint }
    // misturado com objetos normais. JSON.stringify default explodia.
    const auditPayload = {
      before: { snap: 3n, candles: 850n, ticks: 12000n },
      after:  { inMemory: { assetsReset: 34 }, marketUpdate: 1n, liquidityUpdate: 1n },
    }
    // Antes desse fix: throw "Do not know how to serialize a BigInt"
    // Depois: serializa limpo.
    expect(() => JSON.stringify(auditPayload, bigintSafeReplacer)).not.toThrow()
    const out = JSON.parse(JSON.stringify(auditPayload, bigintSafeReplacer))
    expect(out.before.snap).toBe(3)
    expect(out.after.marketUpdate).toBe(1)
  })
})
