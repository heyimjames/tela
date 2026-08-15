/**
 * The comparison rules behind the MCP-payload non-interference proof (CLI-520).
 *
 * Split out from the runner so the classifier and the stamp analysis can be
 * unit-tested against known positives *and* known negatives. A verifier that has
 * only ever seen inputs it accepts is not a verifier; this project has paid for
 * that lesson more than once (CLI-516, CLI-528).
 *
 * ## What is being proved, and what is deliberately not
 *
 * The release artifact carries two very different kinds of content:
 *
 * - **The certified MCP payload** — `bin/`, `dist/mcp/`, `schemas/`, the
 *   lockfile, and the fonts and images the bridge serves. This must not move.
 * - **The application chrome** — `dist-bridge/assets/index-*.js|css` and the
 *   `index.html` naming them. Milestone 2 added gated-off workspace code to the
 *   app, so these bytes *do* move, by design.
 *
 * A literal "the whole artifact hashes the same" check cannot pass and never
 * could: `scripts/build-release.mjs` stamps the release commit into the compiled
 * output and into provenance/SBOM/NOTICES, so any two distinct commits produce
 * distinct artifacts even for an empty source diff. Asserting the impossible
 * would force someone to weaken the check until it passed, which is how evidence
 * harnesses start minting false records. The invariant is therefore scoped to
 * the surfaces certification rests on, and the excluded surfaces are enumerated
 * here rather than waved at.
 *
 * ## Why the stamp normalisation cannot hide anything
 *
 * The four stamped files are *not* compared after erasing everything hex-shaped.
 * A `[0-9a-f]{40}` regex would also erase a moved asset hash or a lockfile
 * integrity value — precisely the drift this check exists to catch. Instead the
 * baseline record pins, per file: its exact byte length, the exact offsets at
 * which the baseline commit appeared, and the sha256 of the file with *only*
 * those ranges blanked. A current file passes only when it is the same length,
 * its own commit appears at exactly the same offsets and nowhere else, and the
 * identically-blanked bytes hash to the recorded value. The masked region is
 * bounded by the record, so a byte that moved anywhere else changes the
 * normalised hash and fails.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'

/** The four files the release pipeline stamps with the source commit. */
export const STAMPED_PATHS = Object.freeze(['NOTICES', 'dist/mcp/tela-mcp.mjs', 'provenance.json', 'sbom.json'])

/**
 * The application-chrome paths whose bytes are expected to move.
 *
 * Vite content-hashes the entry chunk names, so the two bundles never share a
 * filename. Each pattern collapses to a stable token for the structural
 * comparison, and each token's expected multiplicity is pinned: a *second* entry
 * chunk means the app's build shape changed, which is a human decision rather
 * than something this check should absorb silently (CLI-533).
 */
export const APP_CHROME_PATTERNS = Object.freeze([
  { token: 'dist-bridge/index.html', pattern: /^dist-bridge\/index\.html$/, expected: 1 },
  { token: 'dist-bridge/assets/index-*.js', pattern: /^dist-bridge\/assets\/index-[A-Za-z0-9_-]+\.js$/, expected: 1 },
  { token: 'dist-bridge/assets/index-*.css', pattern: /^dist-bridge\/assets\/index-[A-Za-z0-9_-]+\.css$/, expected: 1 },
])

/** Payload metadata compared structurally rather than byte for byte. */
export const METADATA_PATHS = Object.freeze(['package.json'])

/**
 * `package.json` keys that must be identical between the two payloads —
 * everything the payload's own install and launch depend on. `scripts` is the
 * one key allowed to differ, and even that is reported rather than ignored.
 */
export const PACKAGE_JSON_PINNED_KEYS = Object.freeze([
  'name',
  'version',
  'type',
  'bin',
  'exports',
  'main',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'overrides',
  'engines',
])

export const COMMIT_LENGTH = 40
const COMMIT_RE = /^[0-9a-f]{40}$/
/**
 * The blanking byte. Deliberately not hex: a normalised buffer can never be
 * mistaken for, or collide with, an un-normalised one.
 */
const MASK_BYTE = 0x5f // '_'

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Every regular file under `directory`, hashed from the bytes on disk.
 *
 * Deliberately not read from the artifact's own `SHA256SUMS`: that file is a
 * claim made by the thing under test, and comparing two claims is not comparing
 * two payloads. `SHA256SUMS` itself is skipped — it is a derived restatement of
 * everything else, so including it would report one failure twice.
 */
export async function hashTree(directory, prefix = '') {
  const out = new Map()
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) for (const [child, sha] of await hashTree(directory, path)) out.set(child, sha)
    else if (entry.isFile() && path !== 'SHA256SUMS') out.set(path.split(sep).join('/'), sha256(await readFile(join(directory, path))))
  }
  return out
}

/** The class a payload path falls into. Pure function of the path. */
export function classifyPath(path) {
  if (STAMPED_PATHS.includes(path)) return { kind: 'stamped', token: path }
  for (const entry of APP_CHROME_PATTERNS) {
    if (entry.pattern.test(path)) return { kind: 'app-chrome', token: entry.token }
  }
  if (METADATA_PATHS.includes(path)) return { kind: 'metadata', token: path }
  return { kind: 'identical', token: path }
}

/** Every offset at which `commit` appears in `bytes`, including overlaps. */
export function locateStampSites(bytes, commit) {
  if (!COMMIT_RE.test(commit)) throw new Error('commit must be 40-character lowercase hex')
  const haystack = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length)
  const needle = Buffer.from(commit, 'latin1')
  const offsets = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    offsets.push(at)
    from = at + 1
  }
  return offsets
}

/** A copy of `bytes` with each `offsets[i]`..+40 range replaced by the mask byte. */
export function blankStampSites(bytes, offsets) {
  const copy = Buffer.from(bytes)
  for (const offset of offsets) {
    if (offset < 0 || offset + COMMIT_LENGTH > copy.length) throw new Error(`stamp site ${offset} lies outside the file`)
    copy.fill(MASK_BYTE, offset, offset + COMMIT_LENGTH)
  }
  return copy
}

/**
 * The record pinned into the committed baseline for one stamped file.
 * `{ size, offsets, normalizedSha256 }`.
 */
export function describeStamped(bytes, commit, sha256) {
  const offsets = locateStampSites(bytes, commit)
  if (offsets.length === 0) throw new Error('the file records no commit stamp, so it is not a stamped file')
  return { size: bytes.length, offsets, normalizedSha256: sha256(blankStampSites(bytes, offsets)) }
}

/**
 * Check a current stamped file against its baseline record.
 *
 * Returns `{ ok, sites, reason }`. Every clause is load-bearing:
 * size pins the shape, offset equality pins *where* masking is allowed and that
 * no stamp site appeared or vanished, and the normalised hash pins every other
 * byte in the file.
 */
export function verifyStamped({ bytes, commit, record, sha256 }) {
  if (!COMMIT_RE.test(commit)) return { ok: false, sites: 0, reason: 'commit must be 40-character lowercase hex' }
  if (bytes.length !== record.size) {
    return { ok: false, sites: 0, reason: `length differs (baseline ${record.size}, current ${bytes.length}); a commit-stamp swap cannot change length` }
  }
  const offsets = locateStampSites(bytes, commit)
  if (offsets.length === 0) return { ok: false, sites: 0, reason: 'the current file carries no occurrence of its own commit, so it was not stamped' }
  if (offsets.length !== record.offsets.length || offsets.some((offset, index) => offset !== record.offsets[index])) {
    return {
      ok: false,
      sites: offsets.length,
      reason: `commit-stamp sites moved: baseline [${record.offsets.join(', ')}], current [${offsets.join(', ')}]`,
    }
  }
  const normalised = sha256(blankStampSites(bytes, offsets))
  if (normalised !== record.normalizedSha256) {
    return { ok: false, sites: offsets.length, reason: `bytes outside the commit stamp moved (normalised ${normalised}, baseline ${record.normalizedSha256})` }
  }
  return { ok: true, sites: offsets.length, reason: null }
}

/**
 * Compare the pinned keys of two `package.json` payload copies.
 *
 * Returns the differing pinned keys (which fail), any differing key outside the
 * pinned set (which also fails, so a new key cannot slip through unexamined),
 * and the script-level delta (reported as an enumerated expected difference).
 */
export function comparePackageJson(baseline, current) {
  const pinnedDifferences = PACKAGE_JSON_PINNED_KEYS.filter(
    (key) => JSON.stringify(baseline[key] ?? null) !== JSON.stringify(current[key] ?? null),
  )
  const baselineScripts = baseline.scripts ?? {}
  const currentScripts = current.scripts ?? {}
  const names = [...new Set([...Object.keys(baselineScripts), ...Object.keys(currentScripts)])].sort()
  const scriptDifferences = names
    .filter((name) => baselineScripts[name] !== currentScripts[name])
    .map((name) => ({ name, baseline: baselineScripts[name] ?? null, current: currentScripts[name] ?? null }))
  const unexpectedKeys = [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
    .filter((key) => !PACKAGE_JSON_PINNED_KEYS.includes(key) && key !== 'scripts')
    .filter((key) => JSON.stringify(baseline[key] ?? null) !== JSON.stringify(current[key] ?? null))
  return { pinnedDifferences, scriptDifferences, unexpectedKeys }
}

/**
 * The analyser's own always-running self-test.
 *
 * A gate's zero is indistinguishable from "nothing was watching" (CLI-528), so
 * the instrument proves on every invocation that it still rejects what it exists
 * to reject. Each control names what it defends. Returns a list of failures.
 */
export function runSelfTest(sha256) {
  const baselineCommit = 'a'.repeat(40)
  const currentCommit = 'b'.repeat(40)
  const otherHash = 'c'.repeat(40)
  const enc = (text) => Buffer.from(text, 'utf8')
  const failures = []
  const check = (name, result, expected) => {
    if (result.ok !== expected) failures.push(`${name}: expected ok=${expected}, got ok=${result.ok} (${result.reason ?? 'no reason'})`)
  }

  // A file carrying two stamp sites and one unrelated 40-hex run, which is the
  // shape that distinguishes this analysis from a hex-erasing regex.
  const baselineBytes = enc(`head ${baselineCommit} asset ${otherHash} tail ${baselineCommit} end`)
  const record = describeStamped(baselineBytes, baselineCommit, sha256)

  check(
    'accepts a genuine stamp swap',
    verifyStamped({ bytes: enc(`head ${currentCommit} asset ${otherHash} tail ${currentCommit} end`), commit: currentCommit, record, sha256 }),
    true,
  )
  check(
    'rejects a byte that moved outside the stamp',
    verifyStamped({ bytes: enc(`head ${currentCommit} asseT ${otherHash} tail ${currentCommit} end`), commit: currentCommit, record, sha256 }),
    false,
  )
  // The load-bearing negative: an unrelated 40-hex run that moved must NOT be
  // normalised away. A `[0-9a-f]{40}` implementation passes this input.
  check(
    'rejects a 40-hex run that is not the build commit',
    verifyStamped({ bytes: enc(`head ${currentCommit} asset ${'d'.repeat(40)} tail ${currentCommit} end`), commit: currentCommit, record, sha256 }),
    false,
  )
  check(
    'rejects a stamp site that vanished',
    verifyStamped({ bytes: enc(`head ${currentCommit} asset ${otherHash} tail ${'e'.repeat(40)} end`), commit: currentCommit, record, sha256 }),
    false,
  )
  check(
    'rejects a length change',
    verifyStamped({ bytes: enc(`head ${currentCommit} asset ${otherHash} tail ${currentCommit} end `), commit: currentCommit, record, sha256 }),
    false,
  )
  check(
    'rejects a file with no stamp at all',
    verifyStamped({ bytes: enc('x'.repeat(baselineBytes.length)), commit: currentCommit, record, sha256 }),
    false,
  )

  for (const [path, expected] of [
    ['dist/mcp/tela-mcp.mjs', 'stamped'],
    ['bin/tela-mcp.mjs', 'identical'],
    ['schemas/tela-document-v1.schema.json', 'identical'],
    ['package-lock.json', 'identical'],
    ['dist-bridge/assets/inter-latin-wght-normal-Dx4kXJAl.woff2', 'identical'],
    ['dist-bridge/assets/index-oUFoBAIC.js', 'app-chrome'],
    ['dist-bridge/assets/index-X3hZssem.css', 'app-chrome'],
    ['package.json', 'metadata'],
  ]) {
    const actual = classifyPath(path).kind
    if (actual !== expected) failures.push(`classifier: "${path}" should be ${expected}, got ${actual}`)
  }

  return failures
}
