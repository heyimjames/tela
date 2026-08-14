/**
 * The pure half of the release pipeline.
 *
 * Everything here is a function from data to bytes with no clock, no
 * environment, and no filesystem, which is what makes the artifact
 * reproducible: two builds of the same commit differ only if their *inputs*
 * differ. Anything that reads the world lives in `build-release.mjs`; anything
 * that decides what the artifact says lives here, where it can be unit-tested
 * without building anything.
 *
 * The determinism rules are the ones the `.tela` format already established, for
 * the same reasons:
 *
 *  - **sorted keys** in every emitted JSON document, so object iteration order
 *    cannot leak into the bytes;
 *  - **sorted entries** in the checksum manifest, the SBOM, and the archive;
 *  - **no timestamps** anywhere in the artifact. A build clock is the single
 *    most common reason a "reproducible" build is not, and every field that
 *    would carry one here is optional in its own specification;
 *  - **no host paths, no builder identity**. Those describe the machine, not
 *    the release, and including them would make two correct builds disagree.
 */

/** Stable-key JSON with a trailing newline. The only JSON shape this pipeline emits. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value), null, 2) + '\n'
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
    return out
  }
  return value
}

// --- Checksum manifest -------------------------------------------------------

/**
 * `sha256sum`-compatible manifest: `<64 hex><two spaces><relative posix path>`.
 *
 * The format is not decorative. It is the format `sha256sum -c` already reads,
 * so a reviewer who does not trust this repository's own verifier can check the
 * artifact with a coreutils binary they do trust.
 */
export function renderSums(entries) {
  return (
    [...entries]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((entry) => `${entry.sha256}  ${entry.path}`)
      .join('\n') + '\n'
  )
}

export function parseSums(text) {
  const entries = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
    if (!match) throw new Error(`malformed SHA256SUMS line: ${line.slice(0, 80)}`)
    entries.push({ sha256: match[1], path: match[2] })
  }
  return entries
}

// --- SBOM --------------------------------------------------------------------

/**
 * CycloneDX 1.5 from the *exact lockfile*, not from what happens to be installed.
 *
 * The lock is the thing the release pins and the thing setup reinstalls, so it
 * is the only honest source for "what is in this artifact". `metadata.timestamp`
 * and `serialNumber` are both optional in CycloneDX and both omitted, because a
 * per-build value in either would mean the SBOM never reproduces.
 */
export function buildSbom({ lock, name, version, sourceCommit }) {
  const components = []
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '') continue
    if (!entry || entry.link) continue
    const packageName = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (!packageName || !entry.version) continue
    const component = {
      type: 'library',
      name: packageName,
      version: entry.version,
      purl: `pkg:npm/${encodeURIComponent(packageName).replace(/%40/g, '@').replace(/%2F/g, '/')}@${entry.version}`,
      scope: entry.dev ? 'optional' : 'required',
    }
    if (entry.license) component.licenses = [{ license: { id: String(entry.license) } }]
    if (entry.resolved) component.externalReferences = [{ type: 'distribution', url: entry.resolved }]
    if (entry.integrity) {
      const [algorithm, value] = String(entry.integrity).split('-')
      if (algorithm && value) {
        component.hashes = [{ alg: algorithm === 'sha512' ? 'SHA-512' : algorithm === 'sha256' ? 'SHA-256' : algorithm.toUpperCase(), content: value }]
      }
    }
    components.push(component)
  }

  // Deduplicate by purl: a lock lists the same package once per install
  // location, and an SBOM with the same component twice is a broken SBOM.
  const byPurl = new Map()
  for (const component of components) if (!byPurl.has(component.purl)) byPurl.set(component.purl, component)

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name,
        version,
        purl: `pkg:npm/${name}@${version}`,
        properties: [{ name: 'tela:source_commit', value: sourceCommit }],
      },
    },
    components: [...byPurl.values()].sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0)),
  }
}

// --- Provenance ---------------------------------------------------------------

export const ALL_ZERO_COMMIT = '0000000000000000000000000000000000000000'

export function assertReleaseCommit(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`source commit must be a 40-character lowercase hex sha, got "${commit}"`)
  }
  if (commit === ALL_ZERO_COMMIT) {
    throw new Error('source commit is the all-zero development constant; a release must stamp the real commit or its provenance means nothing')
  }
  return commit
}

/**
 * The provenance record.
 *
 * Deliberately absent: build time, builder hostname, user, OS, absolute paths,
 * and CI run ids. Every one of those varies between two correct builds of the
 * same commit, and provenance that cannot be reproduced cannot be checked.
 */
export function buildProvenance({ name, version, sourceCommit, repository, toolchain, chromium, contents }) {
  return {
    schema: 'tela-release-provenance/v1',
    artifact: { name, version },
    source: { repository, commit: assertReleaseCommit(sourceCommit) },
    toolchain,
    browser: {
      bundled: false,
      reason:
        'Browser binaries are not shipped in this artifact. Setup downloads the exact Playwright-matched Chromium after the operator approves the plan hash; the runtime never downloads anything itself.',
      playwright: toolchain.playwright,
      chromiumRevision: chromium,
    },
    methodology: {
      name: 'mcp-builder',
      url: 'https://github.com/anthropics/skills/tree/f6656c1256d5a8adfa37db9110046ef20bac644c/skills/mcp-builder',
      commit: 'f6656c1256d5a8adfa37db9110046ef20bac644c',
      license: 'Apache-2.0',
      role: 'build-time design and evaluation methodology only; not a runtime dependency of this artifact',
    },
    contents,
    verification: {
      manifest: 'SHA256SUMS',
      command: 'node scripts/verify-release.mjs <artifact-directory>',
      note: 'Verification reads bytes only. No file in this artifact is imported, executed, or spawned to verify it.',
    },
  }
}

// --- Notices ------------------------------------------------------------------

/**
 * License notices for everything the artifact's lock pulls in.
 *
 * The declared SPDX identifier and the distribution URL for each package, rather
 * than the full text of a few hundred licences: the identifier is the part a
 * reviewer acts on, the URL is where the text lives, and a concatenation of
 * every LICENSE file in `node_modules` would be a megabyte of unreviewable
 * boilerplate that nobody reads and that changes shape with every install.
 */
export function renderNotices({ name, version, sourceCommit, ownLicense, packages }) {
  const lines = [
    `${name} ${version}`,
    `source commit: ${sourceCommit}`,
    '',
    'This artifact bundles compiled output of the project below, together with the',
    'third-party packages listed at the end. Browser binaries are not included.',
    '',
    '='.repeat(72),
    'Project license',
    '='.repeat(72),
    '',
    ownLicense.trimEnd(),
    '',
    '='.repeat(72),
    'Build-time methodology',
    '='.repeat(72),
    '',
    "Anthropic 'mcp-builder' skill, commit f6656c1256d5a8adfa37db9110046ef20bac644c,",
    'licensed Apache-2.0. Used as design and evaluation methodology at build time.',
    'It is not a dependency of this artifact and none of its code is included.',
    '',
    '='.repeat(72),
    'Third-party packages (from the exact lockfile)',
    '='.repeat(72),
    '',
  ]
  const sorted = [...packages].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1))
  for (const entry of sorted) {
    lines.push(`${entry.name}@${entry.version} — ${entry.license ?? 'license not declared in lockfile'}${entry.resolved ? `\n  ${entry.resolved}` : ''}`)
  }
  return lines.join('\n') + '\n'
}

export function lockPackages(lock) {
  const seen = new Map()
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '' || !entry || entry.link || !entry.version) continue
    const packageName = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (!packageName) continue
    const key = `${packageName}@${entry.version}`
    if (seen.has(key)) continue
    seen.set(key, { name: packageName, version: entry.version, license: entry.license, resolved: entry.resolved })
  }
  return [...seen.values()]
}

// --- Deterministic archive -----------------------------------------------------

/**
 * A store-only ZIP with fixed metadata.
 *
 * Store-only, not deflate, on purpose: deflate output depends on the zlib build
 * doing the compressing, so a compressed archive can differ byte-for-byte
 * between two machines that produced identical *contents*. An artifact whose
 * hash depends on the compressor is not reproducible, and the whole point of
 * this file is a hash a third party can re-derive.
 *
 * Every timestamp is the ZIP epoch (1980-01-01), every entry is sorted, and no
 * extra fields or platform attributes are written — the same rules the `.tela`
 * bundle writer follows.
 */
export function deterministicZip(files) {
  const encoder = new TextEncoder()
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of ordered) {
    const nameBytes = encoder.encode(file.path)
    const crc = crc32(file.data)

    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true) // version needed
    localView.setUint16(6, 0, true) // no flags: no UTF-8 bit, no data descriptor
    localView.setUint16(8, 0, true) // stored
    localView.setUint16(10, 0, true) // time 00:00:00
    localView.setUint16(12, 0x0021, true) // date 1980-01-01
    localView.setUint32(14, crc, true)
    localView.setUint32(18, file.data.length, true)
    localView.setUint32(22, file.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    locals.push(local, file.data)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0x0021, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, file.data.length, true)
    centralView.setUint32(24, file.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    // External attributes left at zero: file modes are host state, and a mode
    // recorded here would differ between a developer's umask and CI's.
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length + file.data.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, ordered.length, true)
  endView.setUint16(10, ordered.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  return concat([...locals, ...centrals, end])
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

let crcTable
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[index] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
