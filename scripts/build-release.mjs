#!/usr/bin/env node
/**
 * Build the immutable Tela runtime release artifact.
 *
 * What the artifact is, per the delivery contract: the compiled MCP JavaScript,
 * the production Tela application build the private bridge serves, the portable
 * schemas, the exact lockfile, provenance, an SBOM, licence notices, and a
 * SHA-256 manifest covering every byte. Browser binaries are deliberately *not*
 * included — setup downloads the exact Playwright-matched Chromium after the
 * operator approves the plan hash.
 *
 * Two things make this more than a `cp -r`:
 *
 * **1. The source commit is stamped.** `src/tela/producer.ts` carries an
 * all-zero `SOURCE_COMMIT` in development, and that constant is written into the
 * manifest of every `.tela` bundle the runtime produces. Shipping a release
 * built from the development constant would mean every bundle it ever writes
 * claims to come from commit `000…0` — the provenance chain would be decorative.
 * So the release build passes the commit to both compilers as a build-time
 * define (`TELA_SOURCE_COMMIT`), which the bundlers substitute into the compiled
 * output. Nothing tracked is edited: an earlier version rewrote the literal in
 * the working tree and restored it in a `finally`, which meant a signal-killed
 * or cancelled build left the checkout stamped — poisoning later builds' bundle
 * bytes and any build running concurrently.
 *
 * **2. The output is reproducible.** Sorted entries, canonical JSON, no
 * timestamps, no builder identity, no host paths, and a store-only archive.
 * Building the same commit twice must produce the same manifest digest, and
 * `npm run release:reproduce` asserts exactly that.
 *
 * Usage:
 *   node scripts/build-release.mjs [--out <dir>] [--commit <sha>] [--allow-dirty]
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ALL_ZERO_COMMIT,
  assertReleaseCommit,
  buildProvenance,
  buildSbom,
  canonicalJson,
  deterministicZip,
  lockPackages,
  renderNotices,
  renderSums,
} from './lib/release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = parseArgs(process.argv.slice(2))

/** Everything the artifact carries, in the order a reader should think about it. */
const CONTENTS = [
  { from: 'bin', to: 'bin', description: 'host-manifest entry point (`node ./bin/tela-mcp.mjs`)' },
  { from: 'dist/mcp', to: 'dist/mcp', description: 'compiled MCP server' },
  { from: 'dist-bridge', to: 'dist-bridge', description: 'production Tela application served to the private browser' },
  { from: 'schemas', to: 'schemas', description: 'portable `.tela` JSON schemas' },
]

const SINGLE_FILES = [
  { from: 'package.json', to: 'package.json' },
  { from: 'package-lock.json', to: 'package-lock.json' },
  { from: 'LICENSE', to: 'LICENSE' },
]

async function main() {
  const commit = assertReleaseCommit(args.commit ?? resolveCommit())
  if (!args.allowDirty) assertCleanTree()

  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  const version = packageJson.version

  const outDir = resolve(args.out ?? join(root, 'release', `tela-design-${version}-${commit.slice(0, 12)}`))
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  // Both builds receive the same define, so the compiled server and the
  // application build agree about which commit they came from. They must: the
  // browser-side writer stamps manifests too.
  //
  // `TELA_SOURCEMAP_SOURCES_CONTENT=false` keeps the source-map *mappings* — so a
  // production stack frame still resolves to a file, line, and column — while
  // dropping the inlined TypeScript. Embedded sources would publish the whole
  // codebase to every downloader inside a file that reads as build metadata,
  // which is a distribution decision, not a build detail.
  const buildEnv = { TELA_SOURCE_COMMIT: commit, TELA_SOURCEMAP_SOURCES_CONTENT: 'false' }
  run('npm', ['run', 'build:bridge'], buildEnv)
  run('npm', ['run', 'build:mcp'], buildEnv)

  for (const entry of CONTENTS) {
    const source = join(root, entry.from)
    if (!(await exists(source))) throw new Error(`release input missing: ${entry.from} (run npm run build first)`)
    await cp(source, join(outDir, entry.to), { recursive: true })
  }
  for (const file of SINGLE_FILES) {
    await cp(join(root, file.from), join(outDir, file.to))
  }

  const chromiumRevision = await readChromiumRevision()
  const provenance = buildProvenance({
    name: packageJson.name,
    version,
    sourceCommit: commit,
    repository: 'performance-clickt/tela-design',
    toolchain: {
      node: '22',
      typescript: dependencyVersion(lock, 'typescript'),
      esbuild: dependencyVersion(lock, 'esbuild'),
      vite: dependencyVersion(lock, 'vite'),
      playwright: dependencyVersion(lock, 'playwright'),
      zod: dependencyVersion(lock, 'zod'),
      mcpServerSdk: dependencyVersion(lock, '@modelcontextprotocol/server'),
      mcpClientSdk: dependencyVersion(lock, '@modelcontextprotocol/client'),
    },
    chromium: chromiumRevision,
    contents: [
      ...CONTENTS.map((entry) => ({ path: entry.to, description: entry.description })),
      { path: 'package-lock.json', description: 'exact lockfile; setup installs from this with lifecycle scripts disabled' },
      { path: 'sbom.json', description: 'CycloneDX 1.5 SBOM derived from the exact lockfile' },
      { path: 'NOTICES', description: 'licence notices for the project and every locked package' },
      { path: 'SHA256SUMS', description: 'sha256sum-compatible manifest covering every other file' },
    ],
  })

  await writeFile(join(outDir, 'provenance.json'), canonicalJson(provenance), 'utf8')
  await writeFile(join(outDir, 'sbom.json'), canonicalJson(buildSbom({ lock, name: packageJson.name, version, sourceCommit: commit })), 'utf8')
  await writeFile(
    join(outDir, 'NOTICES'),
    renderNotices({
      name: packageJson.name,
      version,
      sourceCommit: commit,
      ownLicense: await readFile(join(root, 'LICENSE'), 'utf8'),
      packages: lockPackages(lock),
    }),
    'utf8',
  )

  // The manifest last, over everything else. It never covers itself.
  const files = (await collect(outDir)).filter((path) => path !== 'SHA256SUMS')
  const entries = []
  for (const path of files) entries.push({ path, sha256: sha256(await readFile(join(outDir, path))) })
  const sums = renderSums(entries)
  await writeFile(join(outDir, 'SHA256SUMS'), sums, 'utf8')

  // The artifact's identity: one hash over the manifest, which covers every
  // other byte. Quoting this is equivalent to quoting all of them.
  const manifestDigest = sha256(Buffer.from(sums, 'utf8'))

  const zipEntries = [...entries.map((entry) => entry.path), 'SHA256SUMS'].sort()
  const zip = deterministicZip(
    await Promise.all(zipEntries.map(async (path) => ({ path, data: new Uint8Array(await readFile(join(outDir, path))) }))),
  )
  const zipPath = `${outDir}.zip`
  await writeFile(zipPath, zip)

  process.stdout.write(
    canonicalJson({
      artifact: relative(root, outDir),
      archive: relative(root, zipPath),
      source_commit: commit,
      files: entries.length + 1,
      manifest_sha256: manifestDigest,
      archive_sha256: sha256(Buffer.from(zip)),
    }),
  )
}

// --- helpers -----------------------------------------------------------------

function parseArgs(argv) {
  const parsed = { allowDirty: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') parsed.out = argv[++index]
    else if (argv[index] === '--commit') parsed.commit = argv[++index]
    else if (argv[index] === '--allow-dirty') parsed.allowDirty = true
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  return parsed
}

/**
 * The commit being released.
 *
 * `GITHUB_SHA` first so a CI build records the commit the workflow was triggered
 * for, which is not always `HEAD` in a detached checkout.
 */
function resolveCommit() {
  const fromCi = process.env.GITHUB_SHA?.trim()
  if (fromCi) return fromCi.toLowerCase()
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().toLowerCase()
}

/**
 * A dirty tree means the artifact cannot be rebuilt from the commit it claims,
 * which makes the provenance a lie in the most ordinary way possible.
 */
function assertCleanTree() {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
  if (status) {
    throw new Error(
      'the working tree has uncommitted changes, so this artifact could not be reproduced from the commit it would record.\n' +
        'Commit the changes, or pass --allow-dirty for a throwaway build that must not be published.\n' +
        status,
    )
  }
}

/**
 * Run a build step with its stdout redirected to *stderr*.
 *
 * This script's stdout is a machine-readable summary that callers parse. npm
 * prints its own banner and vite prints its bundle table, both to stdout, and
 * either one lands in the middle of the JSON if the child is allowed to inherit
 * fd 1. Build chatter is diagnostics; it belongs on fd 2.
 */
function run(command, commandArgs, env = {}) {
  execFileSync(command, commandArgs, { cwd: root, stdio: ['ignore', 2, 'inherit'], env: { ...process.env, ...env } })
}

function dependencyVersion(lock, name) {
  const entry = lock.packages?.[`node_modules/${name}`]
  if (!entry?.version) throw new Error(`"${name}" is not in the lockfile; the release cannot record a pin it does not have`)
  return entry.version
}

/**
 * The Chromium revision this Playwright build expects.
 *
 * Recorded rather than downloaded: setup uses it to fetch the exact matched
 * browser after approval, and a doctor uses it to check that the browser on the
 * machine is the one this artifact was built against.
 */
async function readChromiumRevision() {
  try {
    const browsers = JSON.parse(await readFile(join(root, 'node_modules/playwright-core/browsers.json'), 'utf8'))
    const chromium = browsers.browsers?.find((browser) => browser.name === 'chromium')
    return chromium?.revision ?? null
  } catch {
    return null
  }
}

/**
 * Every regular file under `directory`, as forward-slash relative paths.
 *
 * A non-regular entry (a symlink, a socket, a device) is a hard error rather
 * than something to skip: skipping it would leave a file in the artifact that
 * SHA256SUMS does not cover, and a manifest that covers all but one file is a
 * manifest an attacker can add that one file to.
 */
async function collect(directory, prefix = '') {
  const out = []
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await collect(join(directory, entry.name), path)))
    else if (entry.isFile()) out.push(path.split(sep).join('/'))
    else throw new Error(`release input is not a regular file and cannot be manifested: ${path.split(sep).join('/')}`)
  }
  return out.sort()
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

export { ALL_ZERO_COMMIT }

main().catch((error) => {
  process.stderr.write(`release build failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
