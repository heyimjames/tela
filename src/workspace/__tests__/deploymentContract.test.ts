/**
 * The compiled API base path, pinned against the deployment contract (CLI-559).
 *
 * The defect this file exists to prevent had no red anywhere. `src/workspace/endpoint.ts`
 * compiled `'/'`, the reverse proxy mounts the API at `/api`, and the disagreement
 * surfaced only as a *successful* HTTP 200 carrying `index.html` — which the app then
 * reported to a user as a wrong password. Nothing was unit-testable about it, because
 * both halves were individually coherent; only their relationship was wrong.
 *
 * So this test asserts the relationship, and it does so across an artefact boundary.
 * The contract is read out of `docs/workspace-deployment.md` — parsed from the Caddy
 * block that document carries, the same block the operator runbook installs — and
 * compared against the value the app actually compiles. Restating `'/api'` as a
 * literal here would prove only that this file agrees with itself: a mutation that
 * changed the default would then be "fixed" by changing this test's literal, and the
 * next reader would have no way to tell which of the two was authoritative.
 *
 * The drift is caught in both directions:
 *
 *  - default moves, document does not  → the equality fails;
 *  - document moves, default does not  → the equality fails;
 *  - the *parse* stops finding a mount → the parse assertions fail, rather than
 *    quietly comparing against a default-of-a-default. An evidence check that
 *    cannot fail is worse than none, so the extracted value is asserted to be a
 *    real, non-empty, absolute path before it is used as the expectation.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEPLOYMENT_API_MOUNT, WORKSPACE_API_BASE_URL } from '../endpoint'

const CONTRACT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/workspace-deployment.md',
)

/**
 * Pull the proxied prefix out of the document's Caddy block.
 *
 * `handle_path /api/*` is the line that decides where the API answers, so it is the
 * line this reads — not a prose sentence, which could be edited into agreement with
 * a stale block sitting three paragraphs below it.
 */
function mountFromContract(markdown: string): string | null {
  const match = /handle_path\s+(\/[^\s*]+)\/\*/.exec(markdown)
  return match === null ? null : match[1]!
}

describe('the compiled workspace API base URL', () => {
  const markdown = readFileSync(CONTRACT_PATH, 'utf8')
  const mount = mountFromContract(markdown)

  it('is documented by a deployment contract that names a real mount', () => {
    // The parse itself, asserted before anything is compared against it. Without
    // this, deleting the Caddy block would turn every assertion below into a
    // comparison against `null` — and a test whose subject can vanish is a test that
    // can pass for the wrong reason.
    expect(mount, `no handle_path mount found in ${CONTRACT_PATH}`).not.toBeNull()
    expect(mount!.startsWith('/')).toBe(true)
    expect(mount!.length).toBeGreaterThan(1)
    // The API is proxied with its prefix stripped, so the backend sees `/v1/...`.
    // If that ever becomes plain `handle`, the compiled default is wrong even when
    // the prefix matches, and this sentence is where a reader is told so.
    expect(markdown).toContain('handle_path is the stripping form')
  })

  it('equals the mount the deployment contract names', () => {
    expect(DEPLOYMENT_API_MOUNT).toBe(mount)
  })

  it('is what a build with no override compiles', () => {
    // The vitest run sets no `VITE_WORKSPACE_API_BASE_URL`, which is the production
    // build's shape. This is the assertion that would have failed on the artifact
    // that shipped the defect.
    expect(import.meta.env.VITE_WORKSPACE_API_BASE_URL).toBeUndefined()
    expect(WORKSPACE_API_BASE_URL).toBe(mount)
  })

  it('is not the origin root, which is what the defect compiled', () => {
    // Named negatively as well as positively. The equality above is the contract;
    // this line is the regression, so a reader searching for `'/'` finds why it is
    // wrong rather than only what is right.
    expect(WORKSPACE_API_BASE_URL).not.toBe('/')
  })
})
