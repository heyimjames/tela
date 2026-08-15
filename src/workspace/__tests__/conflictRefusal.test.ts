/**
 * The behaviour CLI-517 exists to get right: **a refused save never loses work.**
 *
 * Driven end to end through the fake wire server — generated client, error
 * translation, adapter, controller — with two independent clients, so the stale
 * revision is produced the way it happens in production (somebody else saved) rather
 * than by hand-editing a token.
 *
 * The negative assertions are made against the server's own request log, not by
 * reading the implementation: "no retry was issued" is a claim about what went over
 * the wire, and only the wire can settle it.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WorkspaceStorageAdapter } from '@/storage/WorkspaceStorageAdapter'
import { ConflictError } from '@/storage/StorageAdapter'
import { createDesignApiClient, setDesignApiClientForTests } from '../client'
import {
  configureWorkspaceSession,
  downloadRefusedVersion,
  getWorkspaceState,
  openDocument,
  reloadServerVersion,
  resetWorkspaceSessionForTests,
  saveDocument,
} from '../session'
import { FakeServer, fakeBundle } from './fakeServer'
import type { DocumentBridge } from '../documentBridge'

const CREDENTIALS = { email: 'designer@example.test', password: 'correct horse battery staple' }

/**
 * A stand-in for the editor.
 *
 * `buffer` is the user's unsaved work. `apply` is the only thing that can replace
 * it, so counting `apply` calls is exactly the test of "was the buffer touched".
 */
function fakeBridge(initial: Uint8Array) {
  const applied: Uint8Array[] = []
  const downloaded: string[] = []
  let buffer = initial
  const bridge: DocumentBridge = {
    capture: () => buffer,
    apply: async (bundle) => {
      applied.push(bundle)
      buffer = bundle
    },
    download: (name) => {
      downloaded.push(name)
    },
  }
  return {
    bridge,
    applied,
    downloaded,
    edit: (bundle: Uint8Array) => {
      buffer = bundle
    },
    current: () => buffer,
  }
}

async function scenario() {
  const seeded = fakeBundle('Poster', { v: 'server-original' })
  const server = new FakeServer({
    documents: [
      {
        id: 'doc-1',
        title: 'Poster',
        contentRevision: null,
        bundle: null,
        archivedAt: null,
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    ],
  })

  // Client A — the user under test.
  const clientA = createDesignApiClient({ fetch: server.fetch, baseUrl: '/' })
  await clientA.login({ body: CREDENTIALS })
  setDesignApiClientForTests(clientA)
  const adapterA = new WorkspaceStorageAdapter({
    client: () => clientA,
    workspaceId: () => server.workspaceId,
  })

  // Client B — somebody else in the same workspace.
  const clientB = createDesignApiClient({ fetch: server.fetch, baseUrl: '/' })
  await clientB.login({ body: CREDENTIALS })
  const adapterB = new WorkspaceStorageAdapter({
    client: () => clientB,
    workspaceId: () => server.workspaceId,
  })

  // Give the document its first revision so it can be opened.
  const seededRevision = await adapterA.putDocument('doc-1', seeded, null)

  const editor = fakeBridge(seeded)
  configureWorkspaceSession({ bridge: editor.bridge, adapter: adapterA })

  return { server, adapterA, adapterB, editor, seededRevision }
}

describe('conflict refusal', () => {
  beforeEach(() => {
    resetWorkspaceSessionForTests()
    setDesignApiClientForTests(null)
  })

  it('refuses a stale save, surfaces the conflict, and leaves the buffer untouched', async () => {
    const { server, adapterB, editor } = await scenario()

    await openDocument('doc-1')
    expect(getWorkspaceState().open?.contentRevision).toBeDefined()
    const appliedOnOpen = editor.applied.length
    expect(appliedOnOpen).toBe(1)

    // A first save from this client succeeds.
    editor.edit(fakeBundle('Poster', { v: 'mine-1' }))
    await expect(saveDocument()).resolves.toEqual({ kind: 'saved' })

    // Somebody else saves, moving the server's revision.
    const theirs = await adapterB.getDocument('doc-1')
    await adapterB.putDocument('doc-1', fakeBundle('Poster', { v: 'theirs' }), theirs.contentRevision)

    // The user keeps working and saves from what is now a stale base.
    const myWork = fakeBundle('Poster', { v: 'mine-2-precious-unsaved-work' })
    editor.edit(myWork)
    const putsBefore = server.requestsMatching('PUT', '/documents/doc-1').length

    const outcome = await saveDocument()

    // (a) A conflict surfaced.
    expect(outcome.kind).toBe('refused')
    const state = getWorkspaceState()
    expect(state.conflict).not.toBeNull()
    expect(state.conflict?.documentId).toBe('doc-1')
    // The revisions, the right way round: the base we sent is not the one the
    // server holds, and they are pinned to distinct values so a swap cannot pass.
    expect(state.conflict?.baseContentRevision).not.toBe(state.conflict?.actualContentRevision)
    expect(state.conflict?.actualContentRevision).toBe(
      server.documents.get('doc-1')?.contentRevision,
    )

    // (b) The UI is told to show a refusal, not a success.
    expect(state.hasUnsavedRefusal).toBe(true)

    // (c) The buffer is unchanged and still holds the user's edits, byte for byte.
    expect([...editor.current()]).toEqual([...myWork])
    expect(editor.applied).toHaveLength(appliedOnOpen)

    // (d) No automatic retry and no overwrite — asserted from the request log.
    const putsAfter = server.requestsMatching('PUT', '/documents/doc-1')
    expect(putsAfter).toHaveLength(putsBefore + 1)
    // And the server still holds the other person's work: the refusal wrote nothing.
    const stored = await adapterB.getDocument('doc-1')
    expect(new TextDecoder().decode(stored.bundle)).toContain('theirs')
  })

  it('does not move the held revision on refusal, so a blind retry is refused too', async () => {
    const { server, adapterB, editor } = await scenario()
    await openDocument('doc-1')
    const heldBefore = getWorkspaceState().open?.contentRevision

    const theirs = await adapterB.getDocument('doc-1')
    await adapterB.putDocument('doc-1', fakeBundle('Poster', { v: 'theirs' }), theirs.contentRevision)

    editor.edit(fakeBundle('Poster', { v: 'mine' }))
    await saveDocument()
    expect(getWorkspaceState().open?.contentRevision).toBe(heldBefore)
    const putsAfterFirstRefusal = server.requestsMatching('PUT', '/documents/doc-1').length

    // Clicking save again must be refused again rather than silently succeeding —
    // a controller that "helpfully" adopted the server's revision would overwrite
    // the other person's work on the second click.
    const second = await saveDocument()
    expect(second.kind).toBe('refused')
    expect(new TextDecoder().decode((await adapterB.getDocument('doc-1')).bundle)).toContain('theirs')
    // Exactly one more PUT: the user's second click. Not two, which is what an
    // internal rebase-and-retry would have produced.
    expect(server.requestsMatching('PUT', '/documents/doc-1')).toHaveLength(
      putsAfterFirstRefusal + 1,
    )
  })

  it('refuses to reload the server version without an explicit confirmation', async () => {
    const { adapterB, editor } = await scenario()
    await openDocument('doc-1')
    const theirs = await adapterB.getDocument('doc-1')
    await adapterB.putDocument('doc-1', fakeBundle('Poster', { v: 'theirs' }), theirs.contentRevision)
    const myWork = fakeBundle('Poster', { v: 'mine' })
    editor.edit(myWork)
    await saveDocument()
    const appliedBefore = editor.applied.length

    await expect(reloadServerVersion(false)).resolves.toBe(false)

    expect(editor.applied).toHaveLength(appliedBefore)
    expect([...editor.current()]).toEqual([...myWork])
    expect(getWorkspaceState().conflict).not.toBeNull()
  })

  it('replaces the buffer only once the user confirms, and says so', async () => {
    const { adapterB, editor } = await scenario()
    await openDocument('doc-1')
    const theirs = await adapterB.getDocument('doc-1')
    const afterTheirWrite = await adapterB.putDocument(
      'doc-1',
      fakeBundle('Poster', { v: 'theirs' }),
      theirs.contentRevision,
    )
    editor.edit(fakeBundle('Poster', { v: 'mine' }))
    await saveDocument()

    await expect(reloadServerVersion(true)).resolves.toBe(true)

    expect(new TextDecoder().decode(editor.current())).toContain('theirs')
    expect(getWorkspaceState().conflict).toBeNull()
    expect(getWorkspaceState().hasUnsavedRefusal).toBe(false)
    // The held revision now matches what the server actually holds, so the next
    // save can succeed. Compared against the revision the other client's write
    // produced, not the one it was based on.
    expect(getWorkspaceState().open?.contentRevision).toBe(afterTheirWrite.contentRevision)
    expect(getWorkspaceState().notice).toMatch(/discarded/i)
  })

  it('downloads the refused version without touching the buffer or the server', async () => {
    const { server, adapterB, editor } = await scenario()
    await openDocument('doc-1')
    const theirs = await adapterB.getDocument('doc-1')
    await adapterB.putDocument('doc-1', fakeBundle('Poster', { v: 'theirs' }), theirs.contentRevision)
    const myWork = fakeBundle('Poster', { v: 'mine' })
    editor.edit(myWork)
    await saveDocument()
    const requestsBefore = server.requests.length

    downloadRefusedVersion('Poster')

    expect(editor.downloaded).toEqual(['Poster'])
    expect([...editor.current()]).toEqual([...myWork])
    expect(server.requests).toHaveLength(requestsBefore)
  })

  it('holds the refused bytes on the conflict, so the fallback cannot be empty', async () => {
    const { adapterB, editor } = await scenario()
    await openDocument('doc-1')
    const theirs = await adapterB.getDocument('doc-1')
    await adapterB.putDocument('doc-1', fakeBundle('Poster', { v: 'theirs' }), theirs.contentRevision)
    const myWork = fakeBundle('Poster', { v: 'mine' })
    editor.edit(myWork)

    await saveDocument()

    const refused = getWorkspaceState().conflict?.refusedBundle
    expect(refused).toBeDefined()
    expect([...refused!]).toEqual([...myWork])
  })

  it('surfaces the adapter-level ConflictError type, not a generic failure', async () => {
    const { server, adapterB } = await scenario()
    const stale = await adapterB.getDocument('doc-1')
    await adapterB.putDocument('doc-1', fakeBundle('Poster', { v: 'theirs' }), stale.contentRevision)

    const adapterA = new WorkspaceStorageAdapter({
      client: () => createDesignApiClient({ fetch: server.fetch, baseUrl: '/' }),
      workspaceId: () => server.workspaceId,
    })
    const error = await adapterA
      .putDocument('doc-1', fakeBundle('Poster', { v: 'mine' }), stale.contentRevision)
      .then(() => null, (raised: unknown) => raised)

    expect(error).toBeInstanceOf(ConflictError)
  })
})
