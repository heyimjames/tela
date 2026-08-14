/**
 * Decoding an asset payload has to fail *closed*.
 *
 * Everything downstream — the sniff, the hash, the manifest entry — describes
 * whatever bytes come out of here. A decoder that quietly drops or mangles input
 * therefore does not produce a decode error; it produces a bundle that is internally
 * consistent about the wrong bytes, which no later check can catch.
 */

import { describe, it, expect } from 'vitest'
import { base64Encode, base64Decode } from './assets'
import { sniffMime } from './mime'

describe('base64', () => {
  it('round-trips every remainder', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) & 0xff)
      expect([...base64Decode(base64Encode(bytes))]).toEqual([...bytes])
    }
  })

  it('ignores whitespace, as real-world data: URLs contain it', () => {
    expect([...base64Decode('AQ ID\n')]).toEqual([1, 2, 3])
  })

  it('accepts trailing padding', () => {
    expect([...base64Decode('AQI=')]).toEqual([1, 2])
    expect([...base64Decode('AQ==')]).toEqual([1])
  })

  it('rejects a character outside the Latin-1 table instead of decoding it as zero', () => {
    // A mangled or re-encoded data: URL can carry these. The lookup table only
    // covers 256 entries, so anything above it must be rejected explicitly rather
    // than reading `undefined` and contributing zero bits.
    expect(() => base64Decode('AAAAŁAAA')).toThrow(/invalid base64/)
    expect(() => base64Decode('AAAA\u{1F600}AAA')).toThrow(/invalid base64/)
  })

  it('rejects padding anywhere but the end, instead of truncating there', () => {
    expect(() => base64Decode('AQ=DAQID')).toThrow(/invalid base64/)
    expect(() => base64Decode('AQID===')).toThrow(/invalid base64/)
  })

  it('rejects a trailing group that cannot encode a whole byte', () => {
    expect(() => base64Decode('AQIDA')).toThrow(/invalid base64/)
  })

  it('rejects a character outside the alphabet', () => {
    expect(() => base64Decode('AQ*D')).toThrow(/invalid base64/)
  })
})

describe('svg sniffing', () => {
  it('recognises an SVG whose inspection window splits a multi-byte character', () => {
    // Non-ASCII metadata pushed across the 4096-byte boundary used to make the
    // strict decoder throw, classifying a perfectly good SVG as unsupported and
    // failing the whole save.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><title>${'é'.repeat(3000)}</title></svg>`
    const bytes = new TextEncoder().encode(svg)
    expect(bytes.length).toBeGreaterThan(4096)
    expect(sniffMime(bytes)).toBe('image/svg+xml')
  })

  it('still refuses bytes that are not valid UTF-8 within the window', () => {
    const bytes = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0xfe, 0x3e])
    expect(sniffMime(bytes)).toBeNull()
  })
})
