/**
 * Workspace mode's adapter — the seam's other side, not yet built.
 *
 * It is compiled into the bundle so that switching the flag on is a configuration
 * change rather than a code change, and so the selection path in `index.ts` is
 * exercised by the same build that ships. Every method rejects until a later issue
 * implements it against the generated API client.
 *
 * There is deliberately no HTTP client, no `fetch`, and no API dependency in this
 * file. Adding one here would put network-capable code in the default build ahead of
 * the review that is supposed to authorize it; the payload this app ships inside is
 * certified offline.
 */

import type { DocumentSummary, StorageAdapter } from './StorageAdapter'

export class NotImplementedError extends Error {
  readonly operation: string

  constructor(operation: string) {
    super(`workspace storage is not yet implemented: ${operation}`)
    // Set explicitly — a downlevelled class extension can otherwise leave this as
    // 'Error', and a caller matching on the name would stop recognising it.
    this.name = 'NotImplementedError'
    this.operation = operation
  }
}

/**
 * Rejects rather than throws synchronously.
 *
 * The interface is async, so a synchronous throw would surface at the call site
 * instead of the promise the caller is awaiting — a different failure shape than the
 * real implementation will have, which is exactly the kind of difference that only
 * shows up once the real one lands.
 */
function unimplemented<T>(operation: string): Promise<T> {
  return Promise.reject(new NotImplementedError(operation))
}

export class WorkspaceStorageAdapter implements StorageAdapter {
  listDocuments(): Promise<DocumentSummary[]> {
    return unimplemented('listDocuments')
  }

  getDocument(_id: string): Promise<{ bundle: Uint8Array; contentRevision: string }> {
    return unimplemented('getDocument')
  }

  putDocument(
    _id: string,
    _bundle: Uint8Array,
    _baseContentRevision: string | null,
  ): Promise<{ contentRevision: string }> {
    return unimplemented('putDocument')
  }

  archiveDocument(_id: string): Promise<void> {
    return unimplemented('archiveDocument')
  }
}
