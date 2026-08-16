/**
 * The MCP-payload non-interference analyser (CLI-520).
 *
 * The full comparison needs a built release artifact, which takes half a minute
 * and a clean tree, so it lives in `npm run verify:payload` and its own CI job.
 * What belongs in the fast suite is the part that decides *what counts as a
 * difference* — because that is the part which, if it silently weakens, turns
 * the whole proof into a green light that means nothing.
 *
 * Every case below is a negative control except the first: the analyser is
 * defined by what it refuses, and a verifier only ever tested on inputs it
 * accepts is not a verifier (CLI-516).
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import {
  APP_CHROME_PATTERNS,
  STAMPED_PATHS,
  classifyPath,
  comparePackageJson,
  describeStamped,
  locateStampSites,
  runSelfTest,
  verifyBaselineRecord,
  verifyStamped,
} from '../../scripts/lib/payload-noninterference.mjs'
import { renderSums } from '../../scripts/lib/release.mjs'

const sha256 = (bytes: Uint8Array | Buffer) => createHash('sha256').update(bytes).digest('hex')

const BASELINE_COMMIT = 'a'.repeat(40)
const CURRENT_COMMIT = 'b'.repeat(40)
const UNRELATED_HASH = 'c'.repeat(40)

/** A stamped file shaped like the real ones: two stamp sites and an unrelated 40-hex run. */
function fixture(commit: string, { asset = UNRELATED_HASH, tail = 'end' } = {}) {
  return Buffer.from(`head ${commit} asset ${asset} tail ${commit} ${tail}`, 'utf8')
}

const record = describeStamped(fixture(BASELINE_COMMIT), BASELINE_COMMIT, sha256)

describe('stamp analysis', () => {
  it('accepts a file that differs only by the commit stamp', () => {
    const verdict = verifyStamped({ bytes: fixture(CURRENT_COMMIT), commit: CURRENT_COMMIT, record, sha256 })
    expect(verdict.ok).toBe(true)
    // The site count is asserted, not just the verdict: an analysis that found
    // zero sites and returned true would be the vacuous pass this check exists
    // to prevent.
    expect(verdict.sites).toBe(2)
  })

  it('rejects a byte that moved outside the stamp', () => {
    const bytes = fixture(CURRENT_COMMIT)
    bytes[0] = 'H'.charCodeAt(0)
    const verdict = verifyStamped({ bytes, commit: CURRENT_COMMIT, record, sha256 })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('outside the commit stamp')
  })

  // The load-bearing negative. A `[0-9a-f]{40}` implementation passes this
  // input, which is exactly why the analysis is offset-pinned instead.
  it('does not normalise away a 40-hex run that is not the build commit', () => {
    const verdict = verifyStamped({ bytes: fixture(CURRENT_COMMIT, { asset: 'd'.repeat(40) }), commit: CURRENT_COMMIT, record, sha256 })
    expect(verdict.ok).toBe(false)
  })

  it('rejects a stamp site that appeared or vanished', () => {
    const withExtra = Buffer.from(`head ${CURRENT_COMMIT} asset ${UNRELATED_HASH} tail ${CURRENT_COMMIT} ${CURRENT_COMMIT}`, 'utf8')
    expect(verifyStamped({ bytes: withExtra, commit: CURRENT_COMMIT, record, sha256 }).ok).toBe(false)

    const withFewer = Buffer.from(`head ${CURRENT_COMMIT} asset ${UNRELATED_HASH} tail ${'e'.repeat(40)} end`, 'utf8')
    expect(verifyStamped({ bytes: withFewer, commit: CURRENT_COMMIT, record, sha256 }).ok).toBe(false)
  })

  it('rejects a length change', () => {
    expect(verifyStamped({ bytes: fixture(CURRENT_COMMIT, { tail: 'end ' }), commit: CURRENT_COMMIT, record, sha256 }).ok).toBe(false)
  })

  it('rejects a file carrying no stamp at all', () => {
    const bytes = Buffer.alloc(record.size, 'x')
    expect(verifyStamped({ bytes, commit: CURRENT_COMMIT, record, sha256 }).ok).toBe(false)
  })

  it('refuses to build a record for a file that was never stamped', () => {
    expect(() => describeStamped(Buffer.from('no commit here', 'utf8'), BASELINE_COMMIT, sha256)).toThrow(/no commit stamp/)
  })

  it('finds every occurrence of the stamp', () => {
    expect(locateStampSites(fixture(BASELINE_COMMIT), BASELINE_COMMIT)).toHaveLength(2)
    expect(locateStampSites(Buffer.from('nothing', 'utf8'), BASELINE_COMMIT)).toHaveLength(0)
  })
})

describe('path classification', () => {
  it.each([
    ['dist/mcp/tela-mcp.mjs', 'stamped'],
    ['provenance.json', 'stamped'],
    ['bin/tela-mcp.mjs', 'identical'],
    ['schemas/tela-manifest-v1.schema.json', 'identical'],
    ['package-lock.json', 'identical'],
    // A font under the same directory as the entry chunks must NOT be excused
    // as app chrome — the chrome exemption is the widest hole in this check.
    ['dist-bridge/assets/inter-latin-wght-normal-Dx4kXJAl.woff2', 'identical'],
    ['dist-bridge/assets/avatar-001-B9IACwHI.webp', 'identical'],
    ['dist-bridge/assets/index-oUFoBAIC.js', 'app-chrome'],
    ['dist-bridge/assets/index-X3hZssem.css', 'app-chrome'],
    ['dist-bridge/index.html', 'app-chrome'],
    ['package.json', 'metadata'],
  ])('classifies %s as %s', (path, expected) => {
    expect(classifyPath(path).kind).toBe(expected)
  })

  it('pins the excused surfaces so widening them takes a deliberate edit', () => {
    expect([...STAMPED_PATHS]).toEqual(['NOTICES', 'dist/mcp/tela-mcp.mjs', 'provenance.json', 'sbom.json'])
    expect(APP_CHROME_PATTERNS.map((entry) => entry.token)).toEqual([
      'dist-bridge/index.html',
      'dist-bridge/assets/index-*.js',
      'dist-bridge/assets/index-*.css',
    ])
    expect(APP_CHROME_PATTERNS.every((entry) => entry.expected === 1)).toBe(true)
  })
})

describe('payload package.json', () => {
  const baseline = { name: 'tela', version: '0.1.0', dependencies: { zod: '4.4.3' }, scripts: { build: 'vite build' } }

  it('accepts an added script and reports it', () => {
    const { pinnedDifferences, unexpectedKeys, scriptDifferences } = comparePackageJson(baseline, {
      ...baseline,
      scripts: { ...baseline.scripts, 'test:network': 'playwright test' },
    })
    expect(pinnedDifferences).toEqual([])
    expect(unexpectedKeys).toEqual([])
    expect(scriptDifferences).toEqual([{ name: 'test:network', baseline: null, current: 'playwright test' }])
  })

  it('rejects a changed dependency', () => {
    expect(comparePackageJson(baseline, { ...baseline, dependencies: { zod: '4.4.4' } }).pinnedDifferences).toEqual(['dependencies'])
  })

  it('rejects a changed key that is outside the pinned set, rather than ignoring it', () => {
    expect(comparePackageJson(baseline, { ...baseline, files: ['dist'] }).unexpectedKeys).toEqual(['files'])
  })
})

describe('the committed baseline record', () => {
  // The record is the trust anchor: every comparison is made against it rather
  // than against a rebuilt months-old commit. If it can be edited to match a
  // drifted payload, the whole proof launders the change it exists to catch.
  const record = JSON.parse(readFileSync(new URL('../baselines/mcp-payload-a269442.json', import.meta.url), 'utf8'))

  it('is self-consistent: its file hashes reconstruct the published manifest digest', () => {
    expect(verifyBaselineRecord(record, renderSums)).toEqual([])
    // Pinned absolutely, not just "it reconstructs to whatever it claims": this
    // is the digest the baseline release build printed, recorded independently.
    expect(record.recorded_from.artifact_manifest_sha256).toBe('fbd9d51193701432204439a3a4cb533d8f7f66bb58bc7d5e9ad7d0d35373215b')
    expect(record.baseline_commit).toBe('a2694423f66fad8f716e88b5253a60221b0054ca')
    expect(Object.keys(record.files)).toHaveLength(135)
  })

  it('rejects a record whose file hashes were edited to match a drifted payload', () => {
    const tampered = { ...record, files: { ...record.files, 'schemas/tela-document-v1.schema.json': 'b'.repeat(64) } }
    expect(verifyBaselineRecord(tampered, renderSums)[0]).toMatch(/do not reconstruct its recorded manifest digest/)
  })

  it('rejects a record with a missing or malformed stamp entry', () => {
    const withoutStamp = { ...record, stamped: { ...record.stamped, 'provenance.json': undefined } }
    expect(verifyBaselineRecord(withoutStamp, renderSums).some((problem) => problem.includes('provenance.json'))).toBe(true)

    const malformed = { ...record, stamped: { ...record.stamped, 'NOTICES': { size: 1, offsets: [], normalizedSha256: 'nope' } } }
    expect(verifyBaselineRecord(malformed, renderSums).some((problem) => problem.includes('malformed'))).toBe(true)
  })

  it('rejects an empty record rather than reporting a vacuous pass', () => {
    expect(verifyBaselineRecord({ ...record, files: {} }, renderSums)[0]).toMatch(/lists no files/)
  })
})

describe('the harness self-test that ships with the runner', () => {
  it('passes against the real implementation', () => {
    expect(runSelfTest(sha256)).toEqual([])
  })

  it('would fail if the analysis were weakened to erase anything hex-shaped', () => {
    // The mutation the self-test exists to catch, applied to a stand-in: a
    // checker that masks every 40-hex run rather than the recorded offsets.
    const permissive = (bytes: Buffer) => Buffer.from(bytes.toString('latin1').replace(/[0-9a-f]{40}/g, '_'.repeat(40)), 'latin1')
    const baselineBytes = fixture(BASELINE_COMMIT)
    const currentBytes = fixture(CURRENT_COMMIT, { asset: 'd'.repeat(40) })
    // A permissive checker calls these equal; the shipped analysis does not.
    expect(sha256(permissive(baselineBytes))).toBe(sha256(permissive(currentBytes)))
    expect(verifyStamped({ bytes: currentBytes, commit: CURRENT_COMMIT, record, sha256 }).ok).toBe(false)
  })
})
