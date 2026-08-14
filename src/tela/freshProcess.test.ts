/**
 * The acceptance criterion this file exists for:
 *
 *   "A fixture covering every persisted field survives
 *    export → fresh process → import → export without semantic loss."
 *
 * The *fresh process* part is what makes it meaningful. An in-process round trip
 * can pass while quietly depending on a module-level cache, a memoized hash, or an
 * object identity that happens to still be around. Spawning a real child process
 * removes all of that: the child sees only the bytes on disk.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

import { writeBundle } from './bundle'
import { makeFullCoverageDocument } from './__fixtures__/fullCoverage'

const run = promisify(execFile)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')
const VITE_NODE = join(REPOSITORY_ROOT, 'node_modules/.bin/vite-node')
const CHILD = join(REPOSITORY_ROOT, 'src/tela/__fixtures__/freshProcess.child.ts')

let directory: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tela-fresh-'))
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('export → fresh process → import → export', () => {
  it('round-trips the full-coverage fixture with no semantic or byte loss', async () => {
    const input = join(directory, 'input.tela')
    const output = join(directory, 'output.tela')
    const reportPath = join(directory, 'report.json')

    const written = writeBundle(makeFullCoverageDocument())
    await writeFile(input, written)

    await run(VITE_NODE, [CHILD], {
      cwd: REPOSITORY_ROOT,
      // A different timezone and locale in the child, so any dependence on either
      // would surface as a byte difference rather than passing silently.
      env: {
        ...process.env,
        TELA_INPUT: input,
        TELA_OUTPUT: output,
        TELA_REPORT: reportPath,
        TZ: 'Pacific/Kiritimati',
        LANG: 'tr_TR.UTF-8',
        LC_ALL: 'tr_TR.UTF-8',
      },
    })

    const report = JSON.parse(await readFile(reportPath, 'utf8'))

    // Semantic: the revision and the document hash are unchanged.
    expect(report.migrationsApplied).toEqual([])
    expect(report.rewrittenContentRevision).toBe(report.originalContentRevision)
    expect(report.rewrittenDocumentHash).toBe(report.originalDocumentHash)

    // Structural: nothing was dropped on the way through.
    expect(report.pageCount).toBe(2)
    expect(report.frameCount).toBe(3)
    expect(report.layerCount).toBe(18)
    expect(report.assetCount).toBe(6)
    expect(report.fontCount).toBe(1)
    expect(report.versionCount).toBe(1)

    // Byte-level: the file the fresh process wrote is the file it read.
    expect(digest(await readFile(output))).toBe(digest(await readFile(input)))
  }, 120_000)

  it('a fresh process under a Turkish locale produces the same bytes', async () => {
    // The classic locale trap: in tr-TR, uppercasing "i" yields "İ". Anything that
    // case-folds an entry name or sorts a key with a locale-aware comparator would
    // diverge here and nowhere else.
    const input = join(directory, 'locale-input.tela')
    const output = join(directory, 'locale-output.tela')
    const reportPath = join(directory, 'locale-report.json')

    await writeFile(input, writeBundle(makeFullCoverageDocument()))
    await run(VITE_NODE, [CHILD], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        TELA_INPUT: input,
        TELA_OUTPUT: output,
        TELA_REPORT: reportPath,
        LANG: 'tr_TR.UTF-8',
        LC_ALL: 'tr_TR.UTF-8',
        TZ: 'Asia/Kathmandu',
      },
    })

    expect(digest(await readFile(output))).toBe(digest(await readFile(input)))
  }, 120_000)
})
