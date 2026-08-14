/**
 * The other half of the fresh-process round-trip test.
 *
 * Run in a separate `vite-node` process with no shared module state, no warm
 * caches, and no memory of how the bundle was produced. It opens a `.tela` file
 * from disk, saves it straight back out, and reports what it saw. If any part of
 * "lossless" depended on state left behind by the writing process, this is where
 * it shows up.
 */

import { env, exit } from 'node:process'
import { writeFile } from 'node:fs/promises'

import { openTelaFile, saveTelaFile, readTelaFile } from '../nodeIo'
import { canonicalize } from '../canonicalJson'
import { sha256HexUtf8 } from '../sha256'

async function main(): Promise<void> {
  // Paths arrive by environment rather than argv: `vite-node` inserts its own
  // entries into `process.argv`, so positional indices are not stable.
  const inputPath = env.TELA_INPUT
  const outputPath = env.TELA_OUTPUT
  const reportPath = env.TELA_REPORT
  if (!inputPath || !outputPath || !reportPath) {
    throw new Error('TELA_INPUT, TELA_OUTPUT and TELA_REPORT must all be set')
  }

  const opened = await openTelaFile(inputPath)
  const originalManifest = (await readTelaFile(inputPath)).manifest

  await saveTelaFile(outputPath, opened.document)
  const rewritten = await readTelaFile(outputPath)

  const report = {
    documentCanonicalHash: sha256HexUtf8(canonicalize(opened.document)),
    originalContentRevision: originalManifest.contentRevision,
    rewrittenContentRevision: rewritten.manifest.contentRevision,
    originalDocumentHash: originalManifest.document.sha256,
    rewrittenDocumentHash: rewritten.manifest.document.sha256,
    migrationsApplied: opened.migrationsApplied,
    pageCount: opened.document.pages.length,
    frameCount: opened.document.pages.reduce((sum, page) => sum + page.frames.length, 0),
    layerCount: opened.document.pages.reduce(
      (sum, page) => sum + page.frames.reduce((n, frame) => n + frame.layers.length, 0) + page.looseElements.length,
      0,
    ),
    assetCount: rewritten.assets.size,
    fontCount: opened.document.fonts.length,
    versionCount: opened.document.versions.length,
  }

  await writeFile(reportPath, JSON.stringify(report, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error))
  exit(1)
})
