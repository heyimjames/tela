#!/usr/bin/env node
/**
 * The evaluation runner.
 *
 * It is deliberately boring, because an evaluation harness with judgement in it
 * is an evaluation harness that can be argued with. Every question resolves to a
 * scalar, every scalar is compared exactly, and the only interesting logic here
 * is the enforcement of the properties the questions claim:
 *
 *  - **independent** — a fresh server process and a fresh fixture copy per
 *    question, so state cannot leak between them;
 *  - **read-only** — every tool call is intercepted and checked against the
 *    read-only set before it is issued, so a destructive call fails the question
 *    rather than the fixtures;
 *  - **multi-tool** — the distinct tools used are counted, and fewer than two
 *    fails the question even if the answer was right;
 *  - **non-destructive** — the committed fixtures are hashed before and after
 *    the whole run and compared against `DIGESTS.json`.
 *
 * Run it directly (`npm run test:evals`) or import `runEvaluations()` from the
 * vitest wrapper. Both paths do the same thing; the wrapper only exists so the
 * project's single `npm test` covers this too.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { connect, FIXTURE_DIR, makeSeededRoot } from './lib/session.mjs'
import { QUESTIONS, READ_ONLY_TOOLS } from './questions.mjs'

export async function verifyFixtureDigests() {
  const pinned = JSON.parse(await readFile(join(FIXTURE_DIR, 'DIGESTS.json'), 'utf8'))
  const drifted = []
  for (const [name, expected] of Object.entries(pinned.designs)) {
    const actual = createHash('sha256')
      .update(await readFile(join(FIXTURE_DIR, 'designs', name)))
      .digest('hex')
    if (actual !== expected) drifted.push({ name, expected, actual })
  }
  return drifted
}

/**
 * Wrap a client so every tool call is recorded and policed.
 *
 * The check happens *before* the call is issued: catching a destructive call
 * after the fact would mean the fixture had already been written to, and a
 * runner that detects damage is worth much less than one that prevents it.
 */
function policedClient(client, used) {
  return {
    async callTool(request) {
      if (!READ_ONLY_TOOLS.has(request.name)) {
        throw new Error(`evaluation questions are read-only; "${request.name}" is not in the read-only tool set`)
      }
      used.add(request.name)
      return client.callTool(request)
    },
  }
}

export async function runEvaluations({ onProgress } = {}) {
  const driftedBefore = await verifyFixtureDigests()
  if (driftedBefore.length > 0) {
    return {
      ok: false,
      reason: 'fixture-drift',
      drifted: driftedBefore,
      results: [],
      passed: 0,
      total: QUESTIONS.length,
    }
  }

  const results = []
  for (const question of QUESTIONS) {
    const used = new Set()
    const started = Date.now()
    const root = await makeSeededRoot()
    const session = await connect(root)
    let actual
    let error = null
    try {
      actual = await question.resolve(policedClient(session.client, used))
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      await session.close()
    }

    const correct = error === null && actual === question.expected
    const multiTool = used.size >= 2
    const result = {
      id: question.id,
      question: question.question,
      expected: question.expected,
      actual: error === null ? actual : null,
      tools_used: [...used].sort(),
      ok: correct && multiTool,
      duration_ms: Date.now() - started,
      ...(error ? { error } : {}),
      ...(correct && !multiTool ? { error: `answered with a single tool (${[...used].join(', ')}); a question must compose at least two` } : {}),
    }
    results.push(result)
    onProgress?.(result)
  }

  const driftedAfter = await verifyFixtureDigests()
  const passed = results.filter((result) => result.ok).length

  return {
    ok: passed === QUESTIONS.length && driftedAfter.length === 0,
    passed,
    total: QUESTIONS.length,
    fixtures_unchanged: driftedAfter.length === 0,
    drifted: driftedAfter,
    results,
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (invokedDirectly) {
  const report = await runEvaluations({
    onProgress: (result) => process.stderr.write(`${result.ok ? 'ok  ' : 'FAIL'} ${result.id} — ${result.tools_used.length} tools, ${result.duration_ms}ms\n`),
  })
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (!report.ok) process.exitCode = 1
}
