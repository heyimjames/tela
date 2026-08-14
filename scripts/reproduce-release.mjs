#!/usr/bin/env node
/**
 * Prove the release artifact reproduces from the recorded commit.
 *
 * The claim "reproducible build" is only worth anything as an executed check, so
 * this builds the same commit twice into two different directories and compares
 * the manifest digest — one hash over the manifest that covers every other byte.
 * Two builds that agree there agree on every file.
 *
 * The output directory is part of the input to nothing: it is deliberately
 * different between the two runs, so a build that leaked its own output path
 * into the artifact (a source map with an absolute path, a provenance field
 * recording where it was built) fails here rather than in someone else's
 * verification months later.
 *
 * Both artifacts are then verified, so a reproducible-but-broken build cannot
 * pass by being consistently wrong.
 */

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const passthrough = process.argv.slice(2)

const workspace = await mkdtemp(join(tmpdir(), 'tela-reproduce-'))
try {
  const first = await build(join(workspace, 'build-a'))
  const second = await build(join(workspace, 'build-b'))

  for (const artifact of [first, second]) {
    execFileSync(process.execPath, [join(root, 'scripts/verify-release.mjs'), artifact.path], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
  }

  const same = first.manifest_sha256 === second.manifest_sha256
  process.stdout.write(
    JSON.stringify(
      {
        reproducible: same,
        source_commit: first.source_commit,
        manifest_sha256: { first: first.manifest_sha256, second: second.manifest_sha256 },
        archive_sha256: { first: first.archive_sha256, second: second.archive_sha256 },
      },
      null,
      2,
    ) + '\n',
  )

  if (!same) {
    process.stderr.write('the two builds differ; diff the two artifact trees to find the file that carries build-time state\n')
    process.exitCode = 1
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}

async function build(outDir) {
  const stdout = execFileSync(process.execPath, [join(root, 'scripts/build-release.mjs'), '--out', outDir, ...passthrough], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const summary = JSON.parse(stdout)
  return { ...summary, path: outDir }
}
