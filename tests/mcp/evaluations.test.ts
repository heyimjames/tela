/**
 * The mcp-builder evaluations, run as part of the ordinary test suite.
 *
 * The runner is a plain Node script so it can be executed by anything —
 * `npm run test:evals`, a CI step, or a reviewer with a checkout and no test
 * framework. This wrapper exists only so the project's single `npm test`
 * command covers it too, which is what the acceptance criteria ask for.
 *
 * Note what is *not* asserted here: nothing about Claude or Codex. The runner
 * spawns the compiled artifact and drives it with the official MCP client, so
 * these results are protocol evidence. Host parity is a separate claim, proved
 * by launching the installed caches, and it is not this file's job.
 */

import { describe, expect, it } from 'vitest'

import { runEvaluations, verifyFixtureDigests } from '../../evaluations/run.mjs'
import { QUESTIONS, READ_ONLY_TOOLS } from '../../evaluations/questions.mjs'

describe('mcp-builder evaluations', () => {
  it('ships exactly ten questions, each declaring one verifiable answer', () => {
    expect(QUESTIONS).toHaveLength(10)
    const ids = QUESTIONS.map((question) => question.id)
    expect(new Set(ids).size).toBe(10)
    for (const question of QUESTIONS) {
      expect(question.question.length).toBeGreaterThan(20)
      expect(question.why.length).toBeGreaterThan(20)
      expect(['string', 'number']).toContain(typeof question.expected)
    }
  })

  it('keeps every mutating tool out of the read-only set', () => {
    for (const name of READ_ONLY_TOOLS) {
      expect(name).not.toMatch(/^tela_(add|update|set|apply|group|ungroup|reorder|duplicate|archive|import|replace|restore|save|create|render|export)/)
    }
  })

  it('finds the committed fixtures byte-identical to their pinned digests', async () => {
    expect(await verifyFixtureDigests()).toEqual([])
  })

  it('answers all ten correctly, read-only, multi-tool, leaving the fixtures untouched', async () => {
    const report = await runEvaluations()
    const failures = report.results.filter((result) => !result.ok)
    expect(failures.map((result) => `${result.id}: ${result.error ?? `expected ${String(result.expected)}, got ${String(result.actual)}`}`)).toEqual([])
    expect(report.passed).toBe(10)
    expect(report.fixtures_unchanged).toBe(true)
    for (const result of report.results) expect(result.tools_used.length).toBeGreaterThanOrEqual(2)
  }, 120_000)
})
