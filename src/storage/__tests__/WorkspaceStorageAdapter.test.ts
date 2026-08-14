/**
 * The placeholder's contract: every method fails, loudly and asynchronously.
 */

import { describe, it, expect } from 'vitest'
import { WorkspaceStorageAdapter, NotImplementedError } from '../WorkspaceStorageAdapter'
import { ConflictError } from '../StorageAdapter'

describe('WorkspaceStorageAdapter', () => {
  const adapter = new WorkspaceStorageAdapter()

  const calls: Array<[string, () => Promise<unknown>]> = [
    ['listDocuments', () => adapter.listDocuments()],
    ['getDocument', () => adapter.getDocument('doc-1')],
    ['putDocument', () => adapter.putDocument('doc-1', new Uint8Array(), null)],
    ['archiveDocument', () => adapter.archiveDocument('doc-1')],
  ]

  for (const [name, call] of calls) {
    it(`rejects ${name} with the not-implemented error`, async () => {
      await expect(call()).rejects.toBeInstanceOf(NotImplementedError)
      await expect(call()).rejects.toThrow(`workspace storage is not yet implemented: ${name}`)
    })
  }

  it('rejects rather than throwing synchronously', () => {
    // The real implementation will be async, so the placeholder must fail the same
    // way. A synchronous throw would surface at the call site instead of the
    // awaited promise, and callers written against it would break when it lands.
    let promise: Promise<unknown> | undefined
    expect(() => { promise = adapter.listDocuments() }).not.toThrow()
    expect(promise).toBeInstanceOf(Promise)
    return expect(promise).rejects.toBeInstanceOf(NotImplementedError)
  })
})

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
