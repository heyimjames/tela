import { describe, it, expect } from 'vitest'
import { canonicalize, canonicalBytes, CanonicalJsonError } from './canonicalJson'

describe('RFC 8785 canonicalization', () => {
  it('sorts object members by UTF-16 code unit, not insertion order', () => {
    expect(canonicalize({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}')
  })

  it('produces identical output regardless of key insertion order', () => {
    const forward = { alpha: 1, beta: { x: 1, y: 2 }, gamma: [1, 2, 3] }
    const reverse = { gamma: [1, 2, 3], beta: { y: 2, x: 1 }, alpha: 1 }
    expect(canonicalize(forward)).toBe(canonicalize(reverse))
  })

  it('sorts by code unit, which is not the same as locale order', () => {
    // Under a locale-aware comparator "a" would sort before "Z"; under code units
    // every uppercase letter precedes every lowercase one. Getting this wrong is
    // invisible until two machines with different locales disagree on a hash.
    expect(canonicalize({ a: 1, Z: 2 })).toBe('{"Z":2,"a":1}')
  })

  it('orders keys by code unit above the BMP boundary', () => {
    // "\uFB00" (ﬀ) vs "\u{10000}" (surrogate pair starting \uD800): the surrogate
    // pair's first code unit is lower, so it sorts first even though its code
    // *point* is higher. A code-point sort would get this backwards.
    const out = canonicalize({ '\uFB00': 1, '\u{10000}': 2 })
    expect(out.indexOf('\\ud800')).toBeLessThan(out.indexOf('\ufb00'))
  })

  it('normalizes -0 to 0', () => {
    expect(canonicalize({ v: -0 })).toBe('{"v":0}')
    expect(canonicalize({ v: -0 })).toBe(canonicalize({ v: 0 }))
  })

  it('uses ECMAScript number formatting', () => {
    // The last value is written via Number() rather than as a literal: it exceeds
    // double precision, which is exactly the case being pinned down — canonical
    // output must be the *nearest double's* shortest round-tripping form.
    expect(canonicalize([1, 1.5, 1e21, 1e-7, -0.0001, Number('123456789012345678901234567890')])).toBe(
      '[1,1.5,1e+21,1e-7,-0.0001,1.2345678901234568e+29]',
    )
  })

  it('refuses non-finite numbers instead of writing null', () => {
    expect(() => canonicalize({ v: NaN })).toThrow(CanonicalJsonError)
    expect(() => canonicalize({ v: Infinity })).toThrow(CanonicalJsonError)
    expect(() => canonicalize({ v: -Infinity })).toThrow(CanonicalJsonError)
  })

  it('treats an absent key and an explicitly undefined key as the same document', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }))
  })

  it('refuses an undefined array element rather than coercing it to null', () => {
    expect(() => canonicalize([1, undefined, 3])).toThrow(/undefined array element/)
  })

  it('refuses values with no unambiguous JSON projection', () => {
    expect(() => canonicalize({ when: new Date(0) })).toThrow(/only plain objects/)
    expect(() => canonicalize({ m: new Map() })).toThrow(/only plain objects/)
    expect(() => canonicalize({ s: new Set() })).toThrow(/only plain objects/)
    expect(() => canonicalize({ n: 1n })).toThrow(/bigint/)
    expect(() => canonicalize({ f: () => 1 })).toThrow(/function/)
    expect(() => canonicalize({ s: Symbol('x') })).toThrow(/symbol/)
  })

  it('detects circular references', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(() => canonicalize(cyclic)).toThrow(/circular/)
  })

  it('escapes strings the way ECMAScript does, including lone surrogates', () => {
    expect(canonicalize('a\u0000b')).toBe('"a\\u0000b"')
    expect(canonicalize('tab\there')).toBe('"tab\\there"')
    expect(canonicalize('\ud800')).toBe('"\\ud800"')
    // Non-ASCII is emitted literally, not escaped.
    expect(canonicalize('café 🎯')).toBe('"café 🎯"')
  })

  it('emits UTF-8 bytes', () => {
    expect([...canonicalBytes('é')]).toEqual([0x22, 0xc3, 0xa9, 0x22])
  })

  it('reports the path to the offending value', () => {
    expect(() => canonicalize({ pages: [{ frames: [{ x: NaN }] }] })).toThrow(
      /pages\[0\]\.frames\[0\]\.x/,
    )
  })

  it('round-trips through JSON.parse to an equal value', () => {
    const value = { z: [1, { b: 'x', a: null }], a: true }
    expect(JSON.parse(canonicalize(value))).toEqual(value)
  })
})
