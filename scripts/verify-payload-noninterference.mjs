#!/usr/bin/env node
/**
 * Prove Milestone 2 did not disturb the certified MCP payload (CLI-520).
 *
 * Compares a freshly built release artifact against the **committed** baseline
 * record taken from the last pre-Milestone-2 commit, enforcing the
 * surface-scoped invariant recorded on CLI-520:
 *
 *   1. `bin/`, `schemas/`, `package-lock.json` and every other payload file are
 *      byte-identical, with no normalisation of any kind;
 *   2. `dist/mcp/tela-mcp.mjs`, `provenance.json`, `sbom.json` and `NOTICES`
 *      differ *only* at the release pipeline's own 40-character commit stamp,
 *      proved against pinned offsets and a normalised hash rather than asserted
 *      by a regex (see scripts/lib/payload-noninterference.mjs);
 *   3. the `dist-bridge` application chrome is enumerated as an expected delta
 *      with its shape pinned, so a new payload file or a second entry chunk
 *      fails rather than being absorbed;
 *   4. `package.json` differs only in `scripts`.
 *
 * Hashes are recomputed from the bytes on disk. The artifact's own `SHA256SUMS`
 * is a claim by the thing under test, and comparing two claims is not comparing
 * two payloads.
 *
 * Usage:
 *   node scripts/verify-payload-noninterference.mjs <artifact-dir> [--baseline <file>] [--json]
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  APP_CHROME_PATTERNS,
  STAMPED_PATHS,
  classifyPath,
  comparePackageJson,
  hashTree,
  runSelfTest,
  sha256,
  verifyBaselineRecord,
  verifyStamped,
} from './lib/payload-noninterference.mjs'
import { renderSums } from './lib/release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASELINE = join(root, 'tests/baselines/mcp-payload-a92383c.json')

const failures = []
const notes = []

main().catch((error) => {
  process.stderr.write(`payload-noninterference: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
})

async function main() {
  const args = parseArgs(process.argv.slice(2))

  // The instrument checks itself before it is allowed to judge anything.
  const selfTestFailures = runSelfTest(sha256)
  if (selfTestFailures.length > 0) {
    log('SELF-TEST FAILED — the comparison cannot be trusted, nothing was judged')
    for (const failure of selfTestFailures) log(`  - ${failure}`)
    process.exit(2)
  }
  log('self-test ok: the analyser still rejects non-stamp drift, moved stamp sites, unrelated 40-hex runs, and length changes')

  const baseline = JSON.parse(await readFile(args.baseline, 'utf8'))

  // The record is the trust anchor for every comparison below, so it is checked
  // against itself before it is believed: its per-file hashes must reconstruct
  // the baseline artifact's manifest digest, which was published independently
  // by the release build. An edited record cannot quietly launder a real change.
  const recordProblems = verifyBaselineRecord(baseline, renderSums)
  if (recordProblems.length > 0) {
    log('BASELINE RECORD REJECTED — nothing was compared')
    for (const problem of recordProblems) log(`  - ${problem}`)
    process.exit(2)
  }
  log(`baseline record self-consistent: ${Object.keys(baseline.files).length} file hashes reconstruct manifest digest ${baseline.recorded_from.artifact_manifest_sha256}`)

  const artifactDir = resolve(args.artifact)
  const currentCommit = await readCommit(artifactDir)
  const currentFiles = await hashTree(artifactDir)
  const baselineFiles = new Map(Object.entries(baseline.files))

  log(`baseline commit  ${baseline.baseline_commit}  (${baselineFiles.size} files, record ${args.baseline.replace(`${root}${sep}`, '')})`)
  log(`current  commit  ${currentCommit}  (${currentFiles.size} files, artifact ${artifactDir})`)

  // Non-emptiness first: a comparison of two empty sets reports a pass (CLI-527).
  if (baselineFiles.size === 0 || currentFiles.size === 0) fail(`one side of the comparison is empty (baseline ${baselineFiles.size}, current ${currentFiles.size})`)
  if (baseline.baseline_commit === currentCommit) fail('the artifact records the baseline commit; this run would compare a payload with itself')
  for (const path of STAMPED_PATHS) {
    if (!baseline.stamped?.[path]) fail(`the baseline record carries no stamp record for "${path}"`)
  }

  // --- structural comparison -------------------------------------------------
  // Content-hashed chrome names never match across builds, so both sides
  // collapse to stable tokens first. Anything that appears or disappears is a
  // decision for a human, not a difference to explain away.
  const baselineTokens = tokenCounts(baselineFiles.keys())
  const currentTokens = tokenCounts(currentFiles.keys())
  for (const token of [...new Set([...baselineTokens.keys(), ...currentTokens.keys()])].sort()) {
    const before = baselineTokens.get(token) ?? 0
    const after = currentTokens.get(token) ?? 0
    if (before !== after) fail(`payload shape changed: "${token}" appears ${before}x in the baseline and ${after}x now`)
  }
  for (const entry of APP_CHROME_PATTERNS) {
    const count = currentTokens.get(entry.token) ?? 0
    if (count !== entry.expected) fail(`expected exactly ${entry.expected} "${entry.token}" in the payload, found ${count}`)
  }

  // --- per-class comparison --------------------------------------------------
  const buckets = { identical: [], stamped: [], 'app-chrome': [], metadata: [] }
  const appChromeRows = []

  for (const [path, sha] of [...currentFiles].sort()) {
    const { kind, token } = classifyPath(path)
    buckets[kind].push(path)

    if (kind === 'identical') {
      const expected = baselineFiles.get(path)
      if (expected === undefined) fail(`"${path}" is not in the baseline record`)
      else if (expected !== sha) fail(`"${path}" moved: baseline ${expected}, current ${sha}`)
    } else if (kind === 'stamped') {
      const record = baseline.stamped?.[path]
      if (!record) continue
      const verdict = verifyStamped({ bytes: await readFile(join(artifactDir, path)), commit: currentCommit, record, sha256 })
      if (!verdict.ok) fail(`"${path}" differs by more than the commit stamp: ${verdict.reason}`)
      else notes.push({ kind: 'stamped', text: `${path}: identical apart from ${verdict.sites} commit-stamp site(s) at [${record.offsets.join(', ')}]` })
    } else if (kind === 'app-chrome') {
      const before = [...baselineFiles].find(([candidate]) => classifyPath(candidate).token === token)
      appChromeRows.push({ token, path, baselinePath: before?.[0] ?? '(absent)', baselineSha: before?.[1] ?? '(absent)', currentSha: sha })
    } else if (kind === 'metadata') {
      const baselineJson = baseline.metadata?.[path]
      if (!baselineJson) {
        fail(`the baseline record carries no metadata snapshot for "${path}"`)
        continue
      }
      const currentJson = JSON.parse(await readFile(join(artifactDir, path), 'utf8'))
      const { pinnedDifferences, scriptDifferences, unexpectedKeys } = comparePackageJson(baselineJson, currentJson)
      for (const key of pinnedDifferences) fail(`package.json pinned key "${key}" changed — the payload's install or launch surface moved`)
      for (const key of unexpectedKeys) fail(`package.json key "${key}" changed and is not covered by the pinned set`)
      for (const change of scriptDifferences) {
        notes.push({ kind: 'metadata', text: `package.json scripts.${change.name}: ${JSON.stringify(change.baseline)} -> ${JSON.stringify(change.current)} (inert inside the payload: no script is executed by the launcher)` })
      }
    }
  }

  for (const path of baselineFiles.keys()) {
    if (classifyPath(path).kind === 'identical' && !currentFiles.has(path)) fail(`"${path}" is in the baseline but missing from the payload`)
  }
  const stampedMissing = STAMPED_PATHS.filter((path) => !currentFiles.has(path))
  if (stampedMissing.length > 0) fail(`stamped file(s) absent from the payload: ${stampedMissing.join(', ')}`)
  if (buckets.identical.length === 0) fail('no file was compared byte-for-byte; the identical set is empty and the check would be vacuous')

  // --- the evidence line -----------------------------------------------------
  // Printed on every run, pass or fail. A green job is not evidence a check ran
  // (v0.3 r3); these numbers are.
  log('')
  log(`RESULT identical=${buckets.identical.length}/${currentFiles.size} byte-for-byte  stamped=${buckets.stamped.length}  app-chrome=${buckets['app-chrome'].length}  metadata=${buckets.metadata.length}`)
  log('certified surfaces, byte-identical with no normalisation:')
  for (const path of buckets.identical.filter((path) => /^(bin|schemas)\//.test(path) || path === 'package-lock.json').sort()) {
    log(`  ${path}  ${currentFiles.get(path)}`)
  }
  log(`  ...and ${buckets.identical.length - buckets.identical.filter((path) => /^(bin|schemas)\//.test(path) || path === 'package-lock.json').length} further payload files (fonts, images, bridge assets)`)
  log('stamp-normalised — differ only at the pipeline\'s own commit stamp:')
  for (const note of notes.filter((note) => note.kind === 'stamped')) log(`  ${note.text}`)
  log('enumerated expected delta — application chrome (Milestone 2 code, gated off):')
  for (const row of appChromeRows) log(`  ${row.token}: ${row.baselineSha} -> ${row.currentSha}`)
  for (const note of notes.filter((note) => note.kind === 'metadata')) log(`enumerated expected delta — payload metadata:\n  ${note.text}`)

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          baseline_commit: baseline.baseline_commit,
          current_commit: currentCommit,
          files: currentFiles.size,
          identical: buckets.identical.length,
          stamped: buckets.stamped,
          app_chrome: appChromeRows,
          ok: failures.length === 0,
        },
        null,
        2,
      ) + '\n',
    )
  }

  if (failures.length > 0) {
    log('')
    log(`FAILED: ${failures.length} problem(s)`)
    for (const failure of failures) log(`  - ${failure}`)
    process.exit(1)
  }
  log('')
  log('PASS: the certified MCP payload is unchanged; the delta is confined to the enumerated application chrome.')
}

// --- helpers -----------------------------------------------------------------

function parseArgs(argv) {
  const parsed = { baseline: DEFAULT_BASELINE, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--baseline') parsed.baseline = resolve(argv[++index])
    else if (argv[index] === '--json') parsed.json = true
    else if (parsed.artifact === undefined) parsed.artifact = argv[index]
    else throw new Error(`unexpected argument: ${argv[index]}`)
  }
  if (!parsed.artifact) throw new Error('usage: verify-payload-noninterference.mjs <artifact-dir> [--baseline <file>] [--json]')
  return parsed
}

function fail(message) {
  failures.push(message)
}

function log(message) {
  process.stderr.write(message === '' ? '\n' : `payload-noninterference: ${message}\n`)
}

async function readCommit(directory) {
  const provenance = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'))
  const commit = provenance.source?.commit ?? provenance.source_commit ?? provenance.sourceCommit
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`the artifact's provenance.json does not record a usable source commit (got ${JSON.stringify(commit)})`)
  }
  return commit
}

function tokenCounts(paths) {
  const counts = new Map()
  for (const path of paths) {
    if (path === 'SHA256SUMS') continue
    const { token } = classifyPath(path)
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

