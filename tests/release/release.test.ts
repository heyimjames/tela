/**
 * The release pipeline's pure core.
 *
 * Building a full artifact takes half a minute and needs a clean tree, so the
 * expensive end-to-end proof (`npm run release:reproduce`, which builds twice
 * and diffs the manifest digest) is a separate command. What is worth having in
 * the fast suite is the part that decides what the artifact *says*: the
 * determinism rules, the provenance guard, and the manifest format.
 *
 * These are the properties that make the artifact checkable at all. If sorted
 * order or the all-zero-commit guard regresses, every downstream claim —
 * reproducibility, provenance, the SBOM matching the lock — quietly stops
 * meaning anything, and the end-to-end build still passes because it compares
 * two equally wrong artifacts.
 */

import { describe, expect, it } from 'vitest'

import {
  ALL_ZERO_COMMIT,
  assertReleaseCommit,
  buildProvenance,
  buildSbom,
  canonicalJson,
  deterministicZip,
  lockPackages,
  parseSums,
  renderNotices,
  renderSums,
} from '../../scripts/lib/release.mjs'

const LOCK = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'tela', version: '0.1.0' },
    'node_modules/zod': { version: '4.4.3', resolved: 'https://registry.npmjs.org/zod/-/zod-4.4.3.tgz', integrity: 'sha512-abc', license: 'MIT' },
    'node_modules/@scope/thing': { version: '2.0.0', resolved: 'https://registry.npmjs.org/@scope/thing/-/thing-2.0.0.tgz', license: 'Apache-2.0', dev: true },
    // The same package installed twice, which every real lock contains.
    'node_modules/other/node_modules/zod': { version: '4.4.3', resolved: 'https://registry.npmjs.org/zod/-/zod-4.4.3.tgz', license: 'MIT' },
  },
}

describe('canonical output', () => {
  it('emits keys in sorted order regardless of insertion order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}\n')
  })

  it('preserves array order, which is data rather than formatting', () => {
    expect(canonicalJson({ items: ['b', 'a'] })).toContain('"b",\n    "a"')
  })
})

describe('checksum manifest', () => {
  it('sorts by path and round-trips through the sha256sum format', () => {
    const rendered = renderSums([
      { path: 'z.txt', sha256: 'b'.repeat(64) },
      { path: 'a/b.txt', sha256: 'a'.repeat(64) },
    ])
    expect(rendered).toBe(`${'a'.repeat(64)}  a/b.txt\n${'b'.repeat(64)}  z.txt\n`)
    expect(parseSums(rendered).map((entry) => entry.path)).toEqual(['a/b.txt', 'z.txt'])
  })

  it('refuses a malformed line rather than silently skipping it', () => {
    expect(() => parseSums('not a checksum line\n')).toThrow(/malformed/)
  })
})

describe('provenance', () => {
  /**
   * The guard that makes the whole provenance chain worth having. The
   * development build carries an all-zero commit and stamps it into the manifest
   * of every `.tela` bundle it writes; a release built from that constant would
   * produce files claiming to come from commit `000…0` forever.
   */
  it('refuses the all-zero development commit', () => {
    expect(() => assertReleaseCommit(ALL_ZERO_COMMIT)).toThrow(/all-zero/)
  })

  it('refuses anything that is not a 40-character lowercase sha', () => {
    expect(() => assertReleaseCommit('abc')).toThrow(/40-character/)
    expect(() => assertReleaseCommit('A'.repeat(40))).toThrow(/40-character/)
    expect(assertReleaseCommit('a'.repeat(40))).toBe('a'.repeat(40))
  })

  it('records the browser as unbundled with the revision setup must fetch', () => {
    const provenance = buildProvenance({
      name: 'tela',
      version: '0.1.0',
      sourceCommit: 'a'.repeat(40),
      repository: 'performance-clickt/tela-design',
      toolchain: { node: '22', playwright: '1.61.1' },
      chromium: '1228',
      contents: [],
    })
    expect(provenance.browser.bundled).toBe(false)
    expect(provenance.browser.chromiumRevision).toBe('1228')
    expect(provenance.methodology.license).toBe('Apache-2.0')
  })

  /**
   * No clock, no hostname, no paths. Every one of those varies between two
   * correct builds of the same commit, and provenance that cannot be reproduced
   * cannot be checked.
   */
  it('carries no build-time state', () => {
    const rendered = canonicalJson(
      buildProvenance({
        name: 'tela',
        version: '0.1.0',
        sourceCommit: 'a'.repeat(40),
        repository: 'r',
        toolchain: { node: '22', playwright: '1.61.1' },
        chromium: '1228',
        contents: [],
      }),
    )
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    // Narrowly worded: "mcp-builder" is the methodology's name and legitimately
    // appears, so a bare /builder/ here would fail on the correct output.
    expect(rendered).not.toMatch(/"(?:timestamp|builtAt|builtBy|hostname|buildHost|builtOn)"/i)
    expect(rendered).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/)
  })
})

describe('sbom', () => {
  it('derives from the lock, deduplicates repeat installs, and sorts by purl', () => {
    const sbom = buildSbom({ lock: LOCK, name: 'tela', version: '0.1.0', sourceCommit: 'a'.repeat(40) })
    expect(sbom.components.map((component) => component.purl)).toEqual(['pkg:npm/@scope/thing@2.0.0', 'pkg:npm/zod@4.4.3'])
    expect(sbom.components[1].hashes).toEqual([{ alg: 'SHA-512', content: 'abc' }])
    expect(sbom.metadata.component.properties[0].value).toBe('a'.repeat(40))
  })

  it('carries no serial number or timestamp, both of which would break reproducibility', () => {
    const sbom = buildSbom({ lock: LOCK, name: 'tela', version: '0.1.0', sourceCommit: 'a'.repeat(40) })
    // `in`, not a property read: both fields are optional in CycloneDX, and the
    // assertion is that they are absent from the object rather than present and
    // undefined — which is what would actually reach the serialized SBOM.
    expect('serialNumber' in sbom).toBe(false)
    expect('timestamp' in sbom.metadata).toBe(false)
  })

  it('produces identical bytes for the same lock', () => {
    const first = canonicalJson(buildSbom({ lock: LOCK, name: 'tela', version: '0.1.0', sourceCommit: 'a'.repeat(40) }))
    const second = canonicalJson(buildSbom({ lock: structuredClone(LOCK), name: 'tela', version: '0.1.0', sourceCommit: 'a'.repeat(40) }))
    expect(first).toBe(second)
  })
})

describe('notices', () => {
  it('lists every locked package once, sorted, with its declared licence', () => {
    const notices = renderNotices({
      name: 'tela',
      version: '0.1.0',
      sourceCommit: 'a'.repeat(40),
      ownLicense: 'MIT License\n\nCopyright…',
      packages: lockPackages(LOCK),
    })
    expect(notices).toContain('@scope/thing@2.0.0 — Apache-2.0')
    expect(notices).toContain('zod@4.4.3 — MIT')
    expect(notices.match(/zod@4\.4\.3/g)).toHaveLength(1)
    expect(notices.indexOf('@scope/thing')).toBeLessThan(notices.indexOf('zod@'))
    expect(notices).toContain('Apache-2.0')
    expect(notices).toContain('f6656c1256d5a8adfa37db9110046ef20bac644c')
  })
})

describe('deterministic archive', () => {
  const encode = (text: string) => new TextEncoder().encode(text)

  it('produces identical bytes regardless of input order', () => {
    const a = deterministicZip([
      { path: 'b.txt', data: encode('bee') },
      { path: 'a.txt', data: encode('ay') },
    ])
    const b = deterministicZip([
      { path: 'a.txt', data: encode('ay') },
      { path: 'b.txt', data: encode('bee') },
    ])
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('writes a real zip with the fixed 1980 timestamp and no compression', () => {
    const bytes = deterministicZip([{ path: 'a.txt', data: encode('ay') }])
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(8, true)).toBe(0) // stored, not deflated
    expect(view.getUint16(10, true)).toBe(0) // 00:00:00
    expect(view.getUint16(12, true)).toBe(0x0021) // 1980-01-01
  })

  /**
   * Store-only is not laziness. Deflate output depends on the zlib build doing
   * the compressing, so a compressed archive can differ byte-for-byte between
   * two machines that produced identical contents — and an artifact whose hash
   * depends on the compressor is not reproducible.
   */
  it('stores contents verbatim so the archive hash depends only on the contents', () => {
    const payload = 'the quick brown fox jumps over the lazy dog'.repeat(20)
    const bytes = deterministicZip([{ path: 'a.txt', data: encode(payload) }])
    expect(Buffer.from(bytes).toString('utf8')).toContain(payload)
  })
})
