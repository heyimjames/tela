/**
 * The vendored client is pinned, and provably unmodified.
 *
 * CLI-517's acceptance criteria call for the client pinned at exactly `1.0.0`. It is
 * vendored rather than installed from a credentialed registry (see
 * `vendor/design-api-client/SOURCE.md`), so a semver range in `package.json` is not
 * where the pin can live. It lives here instead, which is a stronger check than a
 * range would have been: this asserts the *bytes*, not a version string somebody
 * could bump while editing the code underneath it.
 *
 * The manifest in `SOURCE.md` was verified against the upstream git blobs at
 * vendoring time. This test re-derives it, so an edit to a vendored file fails
 * loudly instead of silently invalidating the provenance that document claims.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VENDOR = fileURLToPath(new URL('../../../vendor/design-api-client/', import.meta.url))

const read = (relativePath: string): Buffer => readFileSync(join(VENDOR, relativePath))
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Parsed out of SOURCE.md rather than duplicated, so the two cannot drift apart. */
function manifestFromSourceDoc(): Map<string, string> {
  const doc = read('SOURCE.md').toString('utf8')
  const entries = new Map<string, string>()
  for (const line of doc.split('\n')) {
    const match = /^\|\s*`([0-9a-f]{64})`\s*\|\s*`([^`]+)`\s*\|$/.exec(line.trim())
    if (match !== null) {
      entries.set(match[2]!, match[1]!)
    }
  }
  return entries
}

describe('vendored @pyrito-ai/design-api-client', () => {
  it('is pinned at exactly 1.0.0', () => {
    const pkg = JSON.parse(read('package.json').toString('utf8')) as {
      name: string
      version: string
    }
    expect(pkg.name).toBe('@pyrito-ai/design-api-client')
    expect(pkg.version).toBe('1.0.0')
  })

  it('matches the sha256 manifest recorded in SOURCE.md', () => {
    const manifest = manifestFromSourceDoc()
    // A manifest that parsed to nothing would make every comparison below vacuous.
    expect(manifest.size).toBe(7)

    const mismatched: string[] = []
    for (const [path, expected] of manifest) {
      if (sha256(read(path)) !== expected) {
        mismatched.push(path)
      }
    }

    expect(mismatched).toEqual([])
  })

  it('records the upstream commit it was taken from', () => {
    const doc = read('SOURCE.md').toString('utf8')
    // A 40-character sha, not a short one: a short sha is not a durable identifier.
    expect(doc).toMatch(/\| Source commit \| `[0-9a-f]{40}`/)
  })

  it('negative control: the manifest check detects a changed byte', () => {
    const manifest = manifestFromSourceDoc()
    const recorded = manifest.get('src/client.ts')
    expect(recorded).toBeDefined()
    const mutated = Buffer.concat([read('src/client.ts'), Buffer.from('\n')])
    expect(sha256(mutated)).not.toBe(recorded)
  })

  it('bakes in no host', () => {
    // The deployment serves the app and the API from one origin. An absolute host
    // compiled into a client that ships inside the MCP payload would point every
    // installation at one machine.
    const client = read('src/client.ts').toString('utf8')
    const literals = client.match(/'https?:\/\/[^']*'/g) ?? []
    // The only occurrences are inside doc comments as examples; none is a default.
    expect(literals).toEqual([])
  })
})
