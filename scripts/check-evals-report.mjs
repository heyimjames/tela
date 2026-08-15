#!/usr/bin/env node
/**
 * Assert that a standalone `npm run test:evals` run actually evaluated something.
 *
 * This exists because the obvious CI step — `run: npm run test:evals` — is a
 * check that can pass vacuously, and the failure mode is not hypothetical. It is
 * documented in `evaluations/run.mjs` itself: the `invokedDirectly` guard
 * compares `import.meta.url` against `process.argv[1]`, and on Windows a
 * hand-built `file://` string parses `D:` as the URL authority, so the guard is
 * false, the CLI block never executes, and the script **exits 0 having run no
 * evaluations at all**. A bare `run:` step is green in exactly that case.
 *
 * So the step's evidence is the report, not the exit code. This script demands
 * the report exist, parse, and describe a full, clean, non-empty run:
 *
 *  - `ok` is true and `fixtures_unchanged` is true — the run's own verdict, and
 *    the confirmation that the hash-pinned fixtures survived it;
 *  - `total` equals `results.length` — the runner reported on every question it
 *    claims to ship, so a truncated run cannot pass as a complete one;
 *  - `passed` equals `total` and `total` is non-zero — the load-bearing line.
 *    Zero-of-zero is the silent no-op, and it is the case `ok: true` alone would
 *    wave through.
 *
 * The number of questions is deliberately *not* pinned here. That constant already
 * lives in `tests/mcp/evaluations.test.ts` (`expect(QUESTIONS).toHaveLength(10)`),
 * and a second hand-copied copy in two workflow files is the kind of duplicate
 * that drifts from the real thing while both keep passing.
 *
 * Usage: node scripts/check-evals-report.mjs <report.json>
 * Exit code 0 means the run happened and every question passed.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function main() {
  const target = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  if (!target) throw new Error('usage: node scripts/check-evals-report.mjs <report.json>')

  const path = resolve(target)
  const raw = await readFile(path, 'utf8')
  if (raw.trim() === '') {
    // The signature of the silent no-op: the script ran, wrote nothing, exited 0.
    throw new Error(`"${path}" is empty; the runner produced no report, which means the CLI entry point never executed`)
  }

  let report
  try {
    report = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`"${path}" is not parseable as JSON (${cause.message}); first 200 bytes: ${JSON.stringify(raw.slice(0, 200))}`)
  }

  const failures = []
  const { ok, passed, total, fixtures_unchanged: fixturesUnchanged, results } = report

  if (!Array.isArray(results)) {
    failures.push(`"results" is not an array (got ${typeof results})`)
  }
  if (!Number.isInteger(total) || total <= 0) {
    failures.push(`"total" is not a positive integer (got ${JSON.stringify(total)}); a run of zero questions is the silent no-op this check exists to catch`)
  }
  if (Array.isArray(results) && Number.isInteger(total) && results.length !== total) {
    failures.push(`"results" holds ${results.length} entr(y|ies) but "total" claims ${total}; the run was truncated`)
  }
  if (!Number.isInteger(passed) || passed !== total) {
    failures.push(`"passed" is ${JSON.stringify(passed)} but "total" is ${JSON.stringify(total)}; not every question passed`)
  }
  if (ok !== true) {
    failures.push(`"ok" is ${JSON.stringify(ok)}, not true`)
  }
  if (fixturesUnchanged !== true) {
    failures.push(`"fixtures_unchanged" is ${JSON.stringify(fixturesUnchanged)}, not true; the run mutated the hash-pinned fixtures`)
  }
  if (Array.isArray(results)) {
    const notOk = results.filter((result) => result?.ok !== true)
    for (const result of notOk.slice(0, 5)) {
      failures.push(`question "${result?.id ?? '<unnamed>'}" did not pass: ${result?.error ?? `expected ${JSON.stringify(result?.expected)}, got ${JSON.stringify(result?.actual)}`}`)
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`evals-standalone FAILED (${failures.length} problem(s)) for ${path}\n`)
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
    process.exitCode = 1
    return
  }

  // The proof line. A job name proves nothing; this names what ran and how much.
  process.stdout.write(`evals-standalone ok passed=${passed}/${total} fixtures_unchanged=true questions=${results.map((result) => result.id).join(',')}\n`)
}

main().catch((error) => {
  process.stderr.write(`evals-standalone FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
