#!/usr/bin/env node
/**
 * Verify a Tela release artifact **without executing any of it**.
 *
 * That constraint is the whole point, and it is worth being precise about what
 * it rules out: this script never `import`s a file from the artifact, never
 * spawns `node` against one, never launches a browser, and never runs an install.
 * It opens files, reads bytes, hashes them, and parses JSON. A reviewer can run
 * it against an artifact they do not trust — which is the only interesting case,
 * because an artifact you already trust needs no verification.
 *
 * What it checks, and why each one is not ceremony:
 *
 *  1. **Every file matches SHA256SUMS, with no extras and no omissions.** Extras
 *     matter as much as mismatches: a manifest that covers nine of ten files is
 *     a manifest an attacker can add a tenth to.
 *  2. **The stamped source commit is real and is actually in the compiled
 *     output.** Provenance that says "built from abc123" while the compiled
 *     server still carries the all-zero development constant is worse than no
 *     provenance, because every `.tela` bundle the runtime writes will inherit
 *     the wrong commit. This is checked by searching the compiled bytes, which
 *     is a read, not a run.
 *  3. **The lockfile is present, exact, and covers every declared dependency.**
 *     Setup installs from it; if it is missing an entry, setup resolves that
 *     package at install time and the artifact stops being pinned.
 *  4. **The SBOM agrees with the lockfile.** An SBOM generated from anything
 *     other than the shipped lock describes a different artifact.
 *  5. **Shipped source maps carry mappings, not sources.** `sourcesContent`
 *     inlines every source file into the map, so a bundler default is enough to
 *     publish the whole TypeScript codebase to every downloader inside a file
 *     that reads as build metadata. The mappings stay — they make a production
 *     stack trace readable and disclose structure, not source.
 *  6. **No browser binaries are bundled.** The contract says setup downloads the
 *     matched Chromium after approval; a browser that arrived inside the
 *     artifact would bypass that approval entirely.
 *
 * Usage: node scripts/verify-release.mjs <artifact-directory> [--json]
 * Exit code 0 means every check passed.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { ALL_ZERO_COMMIT, buildSbom, canonicalJson, parseSums } from './lib/release.mjs'

const REQUIRED = [
  'bin/tela-mcp.mjs',
  'dist/mcp/tela-mcp.mjs',
  'dist-bridge/index.html',
  'schemas/tela-manifest-v1.schema.json',
  'schemas/tela-document-v1.schema.json',
  'package.json',
  'package-lock.json',
  'provenance.json',
  'sbom.json',
  'NOTICES',
  'LICENSE',
  'SHA256SUMS',
]

/** Names and extensions that would mean a browser or native binary got in. */
const BINARY_MARKERS = [/(^|\/)chrome-(mac|linux|win)/i, /(^|\/)Chromium\.app(\/|$)/i, /(^|\/)headless_shell/i, /\.(exe|dll|dylib|so)$/i]

async function main() {
  const [target, ...rest] = process.argv.slice(2)
  if (!target) throw new Error('usage: node scripts/verify-release.mjs <artifact-directory> [--json]')
  const asJson = rest.includes('--json')
  const dir = resolve(target)

  const failures = []
  const checks = []
  const fail = (check, detail) => {
    failures.push(`${check}: ${detail}`)
    checks.push({ check, ok: false, detail })
  }
  const pass = (check, detail) => checks.push({ check, ok: true, detail })

  // --- 1. manifest -----------------------------------------------------------
  const sumsText = await readFile(join(dir, 'SHA256SUMS'), 'utf8')
  const declared = parseSums(sumsText)
  const declaredPaths = new Set(declared.map((entry) => entry.path))
  const collected = await collect(dir)
  const irregular = collected.filter((entry) => typeof entry !== 'string').map((entry) => entry.path)
  if (irregular.length > 0) {
    fail('contents.regular_files', `the artifact contains entries that are not regular files (symlinks or worse): ${irregular.slice(0, 5).join(', ')}`)
  } else {
    pass('contents.regular_files', 'every entry is a regular file or a directory')
  }
  const present = collected.filter((entry) => typeof entry === 'string').filter((path) => path !== 'SHA256SUMS')

  for (const path of present) {
    if (!declaredPaths.has(path)) fail('manifest.complete', `"${path}" is in the artifact but not in SHA256SUMS`)
  }
  let mismatched = 0
  for (const entry of declared) {
    let bytes
    try {
      bytes = await readFile(join(dir, entry.path))
    } catch {
      fail('manifest.complete', `"${entry.path}" is listed in SHA256SUMS but missing from the artifact`)
      continue
    }
    if (sha256(bytes) !== entry.sha256) {
      mismatched += 1
      fail('manifest.digests', `"${entry.path}" does not match its recorded digest`)
    }
  }
  if (mismatched === 0 && failures.length === 0) pass('manifest.digests', `${declared.length} files match SHA256SUMS`)

  for (const required of REQUIRED) {
    if (!(await exists(join(dir, required)))) fail('contents.required', `required entry "${required}" is missing`)
  }
  if (!failures.some((line) => line.startsWith('contents.required'))) pass('contents.required', `${REQUIRED.length} required entries present`)

  // --- 2. provenance ---------------------------------------------------------
  const provenance = JSON.parse(await readFile(join(dir, 'provenance.json'), 'utf8'))
  const commit = provenance?.source?.commit
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    fail('provenance.commit', `source commit is not a 40-character lowercase sha (${String(commit)})`)
  } else if (commit === ALL_ZERO_COMMIT) {
    fail('provenance.commit', 'source commit is the all-zero development constant; this artifact records no usable provenance')
  } else {
    pass('provenance.commit', commit)
  }

  // The stamp actually landed in *every* compiled output — read, not run.
  //
  // Scanning only `dist/mcp/tela-mcp.mjs` would miss the half that matters most
  // in practice: the same producer constant is compiled into `dist-bridge`, and
  // it is the browser-side bundle writer that stamps `.tela` manifests. A stale
  // or swapped bridge build would otherwise pass every check while every design
  // it saves records the all-zero commit.
  if (typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit)) {
    const quoted = (value) => [`'${value}'`, `"${value}"`, `\`${value}\``]
    const compiledScripts = present.filter((path) => /\.(mjs|cjs|js)$/.test(path) && /^(dist|dist-bridge|bin)\//.test(path))
    const stamped = []
    const unstamped = []
    for (const path of compiledScripts) {
      const text = await readFile(join(dir, path), 'utf8')
      if (quoted(commit).some((needle) => text.includes(needle))) stamped.push(path)
      else if (quoted(ALL_ZERO_COMMIT).some((needle) => text.includes(needle))) unstamped.push(path)
    }
    if (unstamped.length > 0) {
      fail('provenance.stamped', `compiled output still carries the all-zero development commit: ${unstamped.slice(0, 5).join(', ')}`)
    } else if (!stamped.includes('dist/mcp/tela-mcp.mjs')) {
      fail('provenance.stamped', 'the compiled MCP server does not contain the recorded source commit; the release stamp did not take effect')
    } else if (!stamped.some((path) => path.startsWith('dist-bridge/'))) {
      fail('provenance.stamped', 'no dist-bridge script carries the recorded source commit; the browser-side bundle writer would stamp .tela manifests from a stale build')
    } else {
      pass('provenance.stamped', `${stamped.length} compiled output(s) carry the recorded commit`)
    }
  }

  if (provenance?.browser?.bundled !== false) fail('provenance.browser', 'provenance does not declare browser binaries as unbundled')
  else pass('provenance.browser', `chromium revision recorded: ${provenance.browser.chromiumRevision ?? 'none'}`)

  // --- 2b. source maps carry mappings, not sources ---------------------------
  //
  // `sourcesContent` inlines the full text of every source file into the map. In
  // a distributed artifact that publishes the entire TypeScript codebase to
  // everyone who downloads the release, inside a file that reads as build
  // metadata — a distribution decision that would be made by accident, by a
  // bundler default, rather than by anyone.
  //
  // The mappings themselves stay: they turn a production stack frame into a
  // file, line, and column, and they disclose structure rather than source.
  //
  // Checked structurally *and* textually. The structural check is authoritative;
  // the text scan catches source smuggled in under some other key, which the
  // structural check would walk straight past.
  const maps = present.filter((path) => path.endsWith('.map'))
  const leaking = []
  for (const path of maps) {
    const raw = await readFile(join(dir, path), 'utf8')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      leaking.push(`${path} (not parseable as a source map)`)
      continue
    }
    const contents = parsed.sourcesContent
    if (Array.isArray(contents) && contents.some((entry) => typeof entry === 'string' && entry.length > 0)) {
      leaking.push(`${path} (sourcesContent holds ${contents.filter(Boolean).length} file(s))`)
      continue
    }
    // Constructs that cannot appear in base64 VLQ mappings or in a path list.
    for (const marker of ['export interface ', 'import type ', 'export const ', 'function ']) {
      if (raw.includes(marker)) {
        leaking.push(`${path} (contains source text: "${marker.trim()}")`)
        break
      }
    }
  }
  if (leaking.length > 0) fail('sourcemaps.no_source_text', `source maps embed original sources: ${leaking.slice(0, 5).join(', ')}`)
  else pass('sourcemaps.no_source_text', maps.length === 0 ? 'no source maps shipped' : `${maps.length} map(s), mappings only`)

  // --- 3. lockfile -----------------------------------------------------------
  const packageJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8'))
  if (lock.lockfileVersion < 3) fail('lock.version', `lockfileVersion ${lock.lockfileVersion} is older than the npm 9+ format this pipeline pins`)
  else pass('lock.version', `lockfileVersion ${lock.lockfileVersion}`)

  if (provenance?.artifact?.version !== packageJson.version) {
    fail('lock.version', `provenance version ${provenance?.artifact?.version} does not match package.json ${packageJson.version}`)
  }

  const declaredDeps = { ...packageJson.dependencies, ...packageJson.devDependencies }
  const missing = Object.keys(declaredDeps).filter((name) => !lock.packages?.[`node_modules/${name}`])
  if (missing.length > 0) fail('lock.complete', `not locked: ${missing.join(', ')}`)
  else pass('lock.complete', `${Object.keys(declaredDeps).length} declared dependencies are locked`)

  // --- 4. sbom ---------------------------------------------------------------
  const sbomText = await readFile(join(dir, 'sbom.json'), 'utf8')
  const expectedSbom = canonicalJson(buildSbom({ lock, name: packageJson.name, version: packageJson.version, sourceCommit: commit }))
  if (sbomText !== expectedSbom) {
    fail('sbom.matches_lock', 'the SBOM is not the one this lockfile produces; it describes a different dependency set')
  } else {
    pass('sbom.matches_lock', `${JSON.parse(sbomText).components.length} components, derived from the shipped lockfile`)
  }

  // --- 5. no bundled browser -------------------------------------------------
  const binaries = present.filter((path) => BINARY_MARKERS.some((marker) => marker.test(path)))
  if (binaries.length > 0) fail('browser.unbundled', `binary payloads present: ${binaries.slice(0, 5).join(', ')}`)
  else pass('browser.unbundled', 'no browser or native binaries in the artifact')

  const manifestDigest = sha256(Buffer.from(sumsText, 'utf8'))
  const report = {
    artifact: dir,
    ok: failures.length === 0,
    manifest_sha256: manifestDigest,
    source_commit: commit,
    files: declared.length + 1,
    checks,
    failures,
  }

  if (asJson) {
    process.stdout.write(canonicalJson(report))
  } else {
    for (const check of checks) process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.check} — ${check.detail}\n`)
    process.stdout.write(`\nmanifest sha256: ${manifestDigest}\n`)
    process.stdout.write(failures.length === 0 ? 'artifact verified without executing it\n' : `\n${failures.length} check(s) failed\n`)
  }
  if (failures.length > 0) process.exitCode = 1
}

/**
 * Every entry in the artifact, as forward-slash relative paths.
 *
 * Non-regular entries (symlinks, sockets, devices) are *reported*, not skipped.
 * Skipping them was a hole in the "no extras and no omissions" guarantee: a
 * symlink into `/tmp` is neither a file nor a directory, so it would be hashed
 * by nobody, listed by nobody, and matched by no binary marker, while the
 * verifier still printed "verified".
 */
async function collect(directory, prefix = '') {
  const out = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await collect(join(directory, entry.name), path)))
    else if (entry.isFile()) out.push(path.split(sep).join('/'))
    else out.push({ path: path.split(sep).join('/'), irregular: true })
  }
  return out.sort((a, b) => (pathOf(a) < pathOf(b) ? -1 : 1))
}

function pathOf(entry) {
  return typeof entry === 'string' ? entry : entry.path
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

main().catch((error) => {
  process.stderr.write(`verification failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
