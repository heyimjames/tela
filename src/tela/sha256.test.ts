import { describe, it, expect } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { sha256Hex, sha256HexUtf8, isSha256Hex } from './sha256'

describe('sha256', () => {
  it('matches the published test vectors', () => {
    expect(sha256HexUtf8('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256HexUtf8('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256HexUtf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('agrees with node:crypto across lengths that straddle every block boundary', () => {
    // 55/56/63/64/65 are where the padding logic changes shape; a hand-written
    // implementation that is wrong is usually wrong at exactly these lengths.
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 4096]) {
      const input = randomBytes(length)
      expect(sha256Hex(new Uint8Array(input))).toBe(createHash('sha256').update(input).digest('hex'))
    }
  })

  it('agrees with node:crypto on random inputs', () => {
    for (let i = 0; i < 100; i++) {
      const input = randomBytes(Math.floor(Math.random() * 3000))
      expect(sha256Hex(new Uint8Array(input))).toBe(createHash('sha256').update(input).digest('hex'))
    }
  })

  it('recognises well-formed digests', () => {
    expect(isSha256Hex('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true)
    expect(isSha256Hex('E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855')).toBe(false)
    expect(isSha256Hex('abc')).toBe(false)
    expect(isSha256Hex(null)).toBe(false)
  })
})
