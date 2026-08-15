/**
 * The workspace adapter's contract, driven through a `fetch` that speaks the wire
 * format (`src/workspace/__tests__/fakeServer.ts`).
 *
 * Nothing here stubs the generated client. Every assertion runs through real URL
 * building, real status handling and the real error classes, because the defects
 * this suite exists to catch — a swapped revision, a `404` that leaks existence, a
 * `401` mistaken for a missing document — all live in that translation.
 *
 * The `ConflictError` block at the bottom is CLI-510's, carried over verbatim: it
 * tests `StorageAdapter`, not the placeholder this issue replaced, and is still true.
 */

import { describe, it, expect } from 'vitest'
import { WorkspaceStorageAdapter } from '../WorkspaceStorageAdapter'
import { ConflictError } from '../StorageAdapter'
import { createDesignApiClient } from '@/workspace/client'
import {
  BundleRejectedError,
  SessionExpiredError,
  WorkspaceNotFoundError,
} from '@/workspace/errors'
import { FakeServer, fakeBundle } from '@/workspace/__tests__/fakeServer'

async function signedIn(server: FakeServer): Promise<WorkspaceStorageAdapter> {
  const client = createDesignApiClient({ fetch: server.fetch, baseUrl: '/' })
  await client.login({ body: { email: 'designer@example.test', password: 'correct horse battery staple' } })
  return new WorkspaceStorageAdapter({ client: () => client, workspaceId: () => server.workspaceId })
}

function serverWithDocument(): FakeServer {
  return new FakeServer({
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
}

describe('WorkspaceStorageAdapter', () => {
  it('lists documents, mapping the API title onto the seam name', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    await adapter.putDocument('doc-1', fakeBundle('Poster', { a: 1 }), null)

    const documents = await adapter.listDocuments()

    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({ id: 'doc-1', name: 'Poster', folderId: null })
    expect(documents[0]?.updatedAt).toBe('2026-08-15T00:00:00.000Z')
  })

  it('round-trips bytes and carries the revision back', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    const bundle = fakeBundle('Poster', { layers: ['a', 'b'] })

    const written = await adapter.putDocument('doc-1', bundle, null)
    const read = await adapter.getDocument('doc-1')

    expect(read.contentRevision).toBe(written.contentRevision)
    // Byte-identical, not merely equal-length: the seam's whole premise is that an
    // adapter cannot lose a field it never interprets.
    expect([...read.bundle]).toEqual([...bundle])
  })

  it('sends the caller base revision as X-Base-Content-Revision, and omits it for a create', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)

    const first = await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)
    await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 2 }), first.contentRevision)

    const puts = server.requestsMatching('PUT', '/documents/doc-1')
    expect(puts).toHaveLength(2)
    // The create asserts "no revision yet" by omitting the header entirely.
    expect(puts[0]?.headers['x-base-content-revision']).toBeUndefined()
    expect(puts[1]?.headers['x-base-content-revision']).toBe(first.contentRevision)
  })

  it('maps a stale base to ConflictError with the revisions the right way round', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    const first = await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)
    const second = await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 2 }), first.contentRevision)
    expect(second.contentRevision).not.toBe(first.contentRevision)

    const rejected = await adapter
      .putDocument('doc-1', fakeBundle('Poster', { v: 3 }), first.contentRevision)
      .then(() => null, (error: unknown) => error)

    expect(rejected).toBeInstanceOf(ConflictError)
    const conflict = rejected as ConflictError
    expect(conflict.documentId).toBe('doc-1')
    // This is the assertion the whole mapping hangs on. The client names the
    // server's revision `expected` and the caller's base `actual` — the reverse of
    // this seam. Both sides are pinned to concrete, *different* values, so a swap
    // fails rather than comparing two copies of the same string.
    expect(conflict.baseContentRevision).toBe(first.contentRevision)
    expect(conflict.actualContentRevision).toBe(second.contentRevision)
  })

  it('writes nothing when it refuses a stale save', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    const first = await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)
    const good = fakeBundle('Poster', { v: 2 })
    await adapter.putDocument('doc-1', good, first.contentRevision)

    await expect(
      adapter.putDocument('doc-1', fakeBundle('Poster', { v: 999 }), first.contentRevision),
    ).rejects.toBeInstanceOf(ConflictError)

    const after = await adapter.getDocument('doc-1')
    expect([...after.bundle]).toEqual([...good])
  })

  it('reports a rename-only save as accepted but not stored', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    const content = { layers: ['a'] }
    const first = await adapter.putDocumentDetailed('doc-1', fakeBundle('Poster', content), null)
    expect(first.storedOurBytes).toBe(true)

    // Same creative content, new title: a different byte string with an identical
    // contentRevision. The server answers 200 and keeps its earlier bytes.
    const renamed = fakeBundle('Poster v2', content)
    const result = await adapter.putDocumentDetailed('doc-1', renamed, first.contentRevision)

    expect(result.contentRevision).toBe(first.contentRevision)
    expect(result.storedOurBytes).toBe(false)
    // The rule from docs/api-v1.md: the response carries the *stored* sha256.
    expect(result.bundleSha256).not.toBe(await sha256Of(renamed))
    // And it is not an error, and nothing retried it.
    expect(server.requestsMatching('PUT', '/documents/doc-1')).toHaveLength(2)
  })

  it('maps 404 to a message that does not claim the workspace exists', async () => {
    const server = new FakeServer()
    const client = createDesignApiClient({ fetch: server.fetch, baseUrl: '/' })
    await client.login({ body: { email: 'designer@example.test', password: 'correct horse battery staple' } })
    const adapter = new WorkspaceStorageAdapter({
      client: () => client,
      workspaceId: () => '99999999-9999-4999-8999-999999999999',
    })

    const error = await adapter.listDocuments().then(() => null, (raised: unknown) => raised)

    expect(error).toBeInstanceOf(WorkspaceNotFoundError)
    const message = (error as Error).message.toLowerCase()
    // The server refuses to distinguish "no such workspace" from "not yours", so the
    // message must not resolve that ambiguity in either direction.
    expect(message).toContain('not found')
    expect(message).not.toMatch(/exists|no access to this workspace|belongs to/)
  })

  it('maps 401 to SessionExpiredError rather than a missing document', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    server.expireSessionOnNextCall = true

    const error = await adapter.listDocuments().then(() => null, (raised: unknown) => raised)

    expect(error).toBeInstanceOf(SessionExpiredError)
    expect(error).not.toBeInstanceOf(WorkspaceNotFoundError)
  })

  it('maps 422 to a typed rejection carrying the class code', async () => {
    const server = serverWithDocument()
    const client = createDesignApiClient({
      fetch: async (input, init) => {
        if ((init?.method ?? 'GET') === 'PUT') {
          return new Response(
            JSON.stringify({
              error: 'bundle_rejected',
              code: 'bundle_zip_bomb',
              message: 'Refused.',
              detail: 'ratio exceeded',
            }),
            { status: 422, headers: { 'content-type': 'application/json' } },
          )
        }
        return server.fetch(input, init)
      },
      baseUrl: '/',
    })
    await client.login({ body: { email: 'designer@example.test', password: 'correct horse battery staple' } })
    const adapter = new WorkspaceStorageAdapter({ client: () => client, workspaceId: () => server.workspaceId })

    const error = await adapter
      .putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)
      .then(() => null, (raised: unknown) => raised)

    expect(error).toBeInstanceOf(BundleRejectedError)
    expect((error as BundleRejectedError).rejectionCode).toBe('bundle_zip_bomb')
    expect((error as BundleRejectedError).detail).toBe('ratio exceeded')
  })

  it('treats archiving an unknown id as a success, per the interface', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)

    await expect(adapter.archiveDocument('no-such-doc')).resolves.toBeUndefined()
  })

  it('still surfaces a session expiry raised during archive', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    server.expireSessionOnNextCall = true

    // The 404-swallow must not be so broad that it eats an authentication failure.
    await expect(adapter.archiveDocument('doc-1')).rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('archives a real document', async () => {
    const server = serverWithDocument()
    const adapter = await signedIn(server)
    await adapter.putDocument('doc-1', fakeBundle('Poster', { v: 1 }), null)

    await adapter.archiveDocument('doc-1')

    expect(await adapter.listDocuments()).toHaveLength(0)
    expect(server.documents.get('doc-1')?.archivedAt).not.toBeNull()
  })

  it('rejects rather than throwing synchronously when no workspace is selected', () => {
    // CLI-510's placeholder made this promise; the real adapter has to keep it, or
    // callers written against the async shape break at the call site instead.
    const adapter = new WorkspaceStorageAdapter()
    let promise: Promise<unknown> | undefined
    expect(() => {
      promise = adapter.listDocuments()
    }).not.toThrow()
    expect(promise).toBeInstanceOf(Promise)
    return expect(promise).rejects.toThrow('No workspace is selected.')
  })
})

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

describe('ConflictError', () => {
  it('carries the revisions it is reporting on', () => {
    const error = new ConflictError('doc-1', 'a'.repeat(64), 'b'.repeat(64))
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ConflictError')
    expect(error.documentId).toBe('doc-1')
    expect(error.baseContentRevision).toBe('a'.repeat(64))
    expect(error.actualContentRevision).toBe('b'.repeat(64))
  })

  it('describes a create that lost its race', () => {
    expect(new ConflictError('doc-1', null, 'c'.repeat(64)).message).toContain('(new)')
  })
})
