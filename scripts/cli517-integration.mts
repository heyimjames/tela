/**
 * CLI-517 integration evidence: this app's workspace layer against the **real**
 * hivemind-design-server, on real Postgres.
 *
 * Not part of `npm test`. The unit suites mock at the HTTP boundary, which proves
 * the translation; this proves the translation matches a server nobody stubbed —
 * real `.tela` validation, real revision bookkeeping, real `409` bodies.
 *
 * Two things it deliberately exercises that a mock cannot:
 *
 *  - **The `Buffer`/`Uint8Array` seam.** CLI-516 found that the generated client
 *    once sent `bytes.slice().buffer`, which for a Node `Buffer` under 4 KiB is the
 *    whole shared pool — 8192 bytes of unrelated memory on the wire. Every test
 *    passed a `Uint8Array` from a zip writer, so nothing caught it. Here the same
 *    bundle is uploaded as a `Uint8Array` and as a `Buffer` read from disk, and
 *    the stored `bundleSha256` is compared against a locally computed one. The
 *    specifically *pooled* sub-4 KiB case cannot be reached here (a valid `.tela`
 *    bundle is ~15 KiB), so it is pinned at the wire level in
 *    `src/workspace/__tests__/bufferSeam.test.ts` instead.
 *  - **The conflict path**, with two clients racing, asserted against the server's
 *    own stored bytes afterwards.
 *
 * Node has no cookie jar, so the session is carried with the client's documented
 * `headers`/`onResponse` hooks. The browser path uses `credentials: 'include'`
 * instead; that difference is confined to `src/workspace/client.ts`.
 *
 * Usage:
 *
 *   CLI517_BASE_URL=http://127.0.0.1:3517 CLI517_WORKSPACE_ID=… \
 *     npm run test:integration:server
 *
 * The named script is the supported entry point: it is what the server repo's
 * `app-integration.yml` should call, so that job depends on a command this repo
 * declares rather than on a path into `node_modules`.
 *
 * It runs under `vite-node`, which the script needs for the `@/` and vendored-client
 * aliases. `vite-node` is **not** a declared dependency of this package: it arrives
 * hoisted as a transitive dependency of `vitest`. Declaring it directly was the
 * obvious fix and is blocked — `package.json`'s `devDependencies` and
 * `package-lock.json` are both certified surfaces of the MCP payload under CLI-520,
 * and adding one line to either fails that gate. See CLI-549 for the measurement
 * and the options; until that is ruled on, the guard against the hoist changing is
 * the loud precondition check in the server repo's job, not this comment.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError, DesignApiClient } from '@performance-clickt/design-api-client'
import { WorkspaceStorageAdapter } from '@/storage/WorkspaceStorageAdapter'
import { ConflictError } from '@/storage/StorageAdapter'
import { WorkspaceNotFoundError } from '@/workspace/errors'
import { writeBundle, readBundleForEditing } from '@/tela/bundle'
import { makeFullCoverageDocument } from '@/tela/__fixtures__/fullCoverage'

const BASE_URL = process.env.CLI517_BASE_URL ?? 'http://127.0.0.1:3517'
const WORKSPACE_ID = process.env.CLI517_WORKSPACE_ID ?? ''
const EMAIL = process.env.CLI517_EMAIL ?? 'designer@example.test'
const PASSWORD = process.env.CLI517_PASSWORD ?? 'correct horse battery staple'

if (WORKSPACE_ID === '') {
  throw new Error('CLI517_WORKSPACE_ID is required')
}

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex')

/** Whether a Buffer sits inside Node's shared pool rather than its own allocation. */
const pooled = (buffer: Buffer): boolean =>
  buffer.byteOffset > 0 || buffer.buffer.byteLength > buffer.byteLength

const checks: Array<{ name: string; ok: boolean; detail: string }> = []
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  — ${detail}`}`)
}

/** A client that carries its session in a header, the documented Node pattern. */
function nodeClient() {
  let cookie: string | null = null
  const client = new DesignApiClient({
    baseUrl: BASE_URL,
    headers: () => (cookie === null ? {} : { cookie }),
    onResponse: (response) => {
      const setCookie = response.headers.get('set-cookie')
      if (setCookie !== null) {
        cookie = setCookie.split(';')[0] ?? null
      }
    },
  })
  return client
}

async function main(): Promise<void> {
  // ---- sign in -----------------------------------------------------------
  const clientA = nodeClient()
  const session = await clientA.login({ body: { email: EMAIL, password: PASSWORD } })
  check(
    'login returns the user and their memberships',
    session.user.email === EMAIL && session.workspaces.some((w) => w.workspaceId === WORKSPACE_ID),
    `workspaces=${session.workspaces.length}`,
  )

  const adapterA = new WorkspaceStorageAdapter({
    client: () => clientA,
    workspaceId: () => WORKSPACE_ID,
  })

  // ---- a real .tela bundle, validated server-side -------------------------
  const document = makeFullCoverageDocument()
  const bundle = writeBundle(document)
  const created = await clientA.createDocument({
    workspaceId: WORKSPACE_ID,
    body: { title: 'CLI-517 integration' },
  })

  const first = await adapterA.putDocumentDetailed(created.id, bundle, null)
  check(
    'the real server accepts a real .tela bundle and stores our exact bytes',
    first.storedOurBytes && first.bundleSha256 === sha256(bundle),
    `contentRevision=${first.contentRevision.slice(0, 12)}…`,
  )

  const readBack = await adapterA.getDocument(created.id)
  check(
    'GET .../bundle returns byte-identical bytes',
    Buffer.compare(Buffer.from(readBack.bundle), Buffer.from(bundle)) === 0,
    `${readBack.bundle.byteLength} bytes`,
  )
  check(
    'the returned revision matches the one the PUT reported',
    readBack.contentRevision === first.contentRevision,
  )
  check(
    'the round-tripped bundle still reads as a valid document',
    readBundleForEditing(readBack.bundle).document.schemaVersion === document.schemaVersion,
  )

  // ---- the Buffer/Uint8Array seam ----------------------------------------
  //
  // If any layer takes `.buffer` without honouring byteOffset/byteLength, the
  // server stores the backing store rather than the file — and its sha256 says so.
  const scratch = mkdtempSync(join(tmpdir(), 'cli517-'))
  const smallPath = join(scratch, 'small.tela')
  const smallBundle = writeBundle(makeFullCoverageDocument())
  writeFileSync(smallPath, smallBundle)
  const asBuffer = readFileSync(smallPath)
  // Honest scope note, earned the hard way: the first run of this script asserted
  // that this Buffer was *pooled*, and that assertion failed — a valid `.tela`
  // bundle is ~15 KiB, and Node allocates standalone at or above
  // `Buffer.poolSize >>> 1`. So this upload exercises a real `Buffer` (a distinct
  // type from `Uint8Array`, with `slice` overridden as `subarray`) against the real
  // server, but it does **not** exercise the pooled case. That one is pinned at the
  // wire level, with a genuinely pooled sub-4 KiB Buffer, in
  // `src/workspace/__tests__/bufferSeam.test.ts`. Reported rather than quietly
  // dropped, because a check that cannot reach its own condition is worse than none.
  check(
    'the uploaded Buffer is a real Buffer (pooled case covered by bufferSeam.test.ts)',
    Buffer.isBuffer(asBuffer) && !pooled(asBuffer),
    `byteLength=${asBuffer.byteLength} backing=${asBuffer.buffer.byteLength} byteOffset=${asBuffer.byteOffset} pooled=false`,
  )

  const bufferDoc = await clientA.createDocument({
    workspaceId: WORKSPACE_ID,
    body: { title: 'CLI-517 buffer seam' },
  })
  const bufferPut = await adapterA.putDocumentDetailed(bufferDoc.id, asBuffer, null)
  check(
    'uploading a Buffer stores exactly its own bytes',
    bufferPut.bundleSha256 === sha256(asBuffer) && bufferPut.storedOurBytes,
    `stored=${bufferPut.bundleSha256.slice(0, 12)}… expected=${sha256(asBuffer).slice(0, 12)}…`,
  )
  const bufferReadBack = await adapterA.getDocument(bufferDoc.id)
  check(
    'and reading it back gives the same length as the file on disk',
    bufferReadBack.bundle.byteLength === asBuffer.byteLength,
    `${bufferReadBack.bundle.byteLength} vs ${asBuffer.byteLength}`,
  )

  // ---- the conflict path, two clients ------------------------------------
  const clientB = nodeClient()
  await clientB.login({ body: { email: EMAIL, password: PASSWORD } })
  const adapterB = new WorkspaceStorageAdapter({
    client: () => clientB,
    workspaceId: () => WORKSPACE_ID,
  })

  const theirDocument = makeFullCoverageDocument()
  theirDocument.pages[0]!.name = 'Edited by the other client'
  const theirBundle = writeBundle(theirDocument)
  const theirPut = await adapterB.putDocument(created.id, theirBundle, first.contentRevision)
  check(
    'the other client saves successfully from the current revision',
    theirPut.contentRevision !== first.contentRevision,
  )

  const myDocument = makeFullCoverageDocument()
  myDocument.pages[0]!.name = 'My unsaved work'
  const myBundle = writeBundle(myDocument)
  let conflict: ConflictError | null = null
  try {
    // Deliberately stale: this is the revision opened before the other write.
    await adapterA.putDocument(created.id, myBundle, first.contentRevision)
  } catch (error) {
    conflict = error instanceof ConflictError ? error : null
    if (conflict === null) {
      throw error
    }
  }

  check('a stale save is refused with a typed ConflictError', conflict !== null)
  check(
    'the conflict reports the base we sent',
    conflict?.baseContentRevision === first.contentRevision,
    `${String(conflict?.baseContentRevision).slice(0, 12)}…`,
  )
  check(
    'the conflict reports the revision the server actually holds',
    conflict?.actualContentRevision === theirPut.contentRevision,
    `${String(conflict?.actualContentRevision).slice(0, 12)}…`,
  )
  check(
    'the two revisions are genuinely different, so the mapping cannot be a coincidence',
    conflict?.baseContentRevision !== conflict?.actualContentRevision,
  )

  const afterRefusal = await adapterB.getDocument(created.id)
  check(
    'the refusal wrote nothing: the server still holds the other client’s bytes',
    Buffer.compare(Buffer.from(afterRefusal.bundle), Buffer.from(theirBundle)) === 0,
  )
  check(
    'and definitely not ours',
    Buffer.compare(Buffer.from(afterRefusal.bundle), Buffer.from(myBundle)) !== 0,
  )

  // Rebasing onto what the server holds succeeds — the documented recovery.
  const rebased = await adapterA.putDocument(created.id, myBundle, afterRefusal.contentRevision)
  check('rebasing onto the server revision succeeds', rebased.contentRevision !== theirPut.contentRevision)

  // ---- 404 semantics -----------------------------------------------------
  const strangerAdapter = new WorkspaceStorageAdapter({
    client: () => clientA,
    workspaceId: () => '00000000-0000-4000-8000-000000000000',
  })
  let notFound: unknown = null
  try {
    await strangerAdapter.listDocuments()
  } catch (error) {
    notFound = error
  }
  check(
    'a workspace we are not a member of maps to WorkspaceNotFoundError',
    notFound instanceof WorkspaceNotFoundError,
  )
  check(
    'and its message does not claim the workspace exists',
    notFound instanceof Error && !/exists|belongs to/i.test(notFound.message),
    notFound instanceof Error ? notFound.message : '',
  )

  // ---- archive + logout --------------------------------------------------
  await adapterA.archiveDocument(bufferDoc.id)
  const remaining = await adapterA.listDocuments()
  check(
    'archiving removes the document from the library listing',
    !remaining.some((entry) => entry.id === bufferDoc.id),
    `${remaining.length} remaining`,
  )
  // `WorkspaceStorageAdapter.archiveDocument` absorbs a **genuine** `404` so that
  // "archiving an id that does not exist is not an error" holds in workspace mode
  // as it does locally, while a `404` that meant something else still propagates.
  //
  // Both halves are asserted, because either one alone is satisfiable without the
  // behaviour existing: asserting only that the adapter resolves would pass just
  // as well against a server that answered `204` and swallowed nothing, and
  // asserting neither — which is what the literal `check(…, true)` here did —
  // passes against anything at all, including an adapter that threw.
  const UNKNOWN_DOCUMENT_ID = '00000000-0000-4000-8000-000000000001'
  let unknownIdApiStatus: number | null = null
  try {
    await clientA.archiveDocument({ workspaceId: WORKSPACE_ID, documentId: UNKNOWN_DOCUMENT_ID })
  } catch (error) {
    unknownIdApiStatus = error instanceof ApiError ? error.status : null
  }
  let unknownIdAdapterError: unknown = null
  try {
    await adapterA.archiveDocument(UNKNOWN_DOCUMENT_ID)
  } catch (error) {
    unknownIdAdapterError = error
  }
  check(
    'archiving an unknown id absorbs the API’s genuine 404 rather than throwing',
    unknownIdApiStatus === 404 && unknownIdAdapterError === null,
    `api=${unknownIdApiStatus === null ? 'did not raise an ApiError' : `${unknownIdApiStatus}`} adapter=${
      unknownIdAdapterError === null
        ? 'resolved'
        : `threw ${unknownIdAdapterError instanceof Error ? unknownIdAdapterError.name : typeof unknownIdAdapterError}`
    }`,
  )

  await clientA.logout()
  let afterLogout: unknown = null
  try {
    await adapterA.listDocuments()
  } catch (error) {
    afterLogout = error
  }
  check(
    'after logout the session is genuinely gone',
    afterLogout !== null,
    afterLogout instanceof Error ? afterLogout.name : '',
  )

  const failed = checks.filter((entry) => !entry.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

await main()
