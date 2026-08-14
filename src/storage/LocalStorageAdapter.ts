/**
 * The default adapter: documents live in this browser and nowhere else.
 *
 * Two stores back it, and keeping them apart is the whole design:
 *
 * - **The index** is the existing `tela-files` library store (`useFileStore`). It is
 *   read here and mutated only through the store's own actions, so its persisted
 *   bytes, its key, its ordering, and its migrations are exactly what they were
 *   before this seam existed. Nothing about the library page changes.
 * - **The body** is the `.tela` bundle, stored verbatim under `tela-bundle:<id>`.
 *   Verbatim is load-bearing: `putDocument` stores the caller's bytes unchanged and
 *   `getDocument` hands the same bytes back, so a save/reload round-trip is
 *   byte-identical by construction rather than by the reader and writer happening to
 *   agree. Re-serializing on either side would make the result depend on the current
 *   schema version and producer stamp, and a document written by an older build
 *   would silently change bytes just by being read.
 *
 * This module is the only place in the app that touches a document storage key. The
 * app-reset helpers and the welcome flag elsewhere address non-document keys and are
 * deliberately left where they are.
 *
 * Nothing here opens a network connection.
 */

import { readBundle } from '@/tela/bundle'
import { base64Encode, base64Decode } from '@/tela/assets'
import { telaError } from '@/tela/errors'
import { useFileStore } from '@/store/useFileStore'
import type { DocumentSummary, StorageAdapter } from './StorageAdapter'

/**
 * Namespace for document bodies.
 *
 * `tela-bundle:` sits alongside the existing `tela-*` cache keys, which matters for
 * the app-reset helpers in `SettingsModal` and `SettingsPage`: both clear every key
 * matching `startsWith('tela-')`, so a reset already removes stored documents too
 * and did not need to learn about this prefix.
 */
export const DOCUMENT_KEY_PREFIX = 'tela-bundle:'

export function documentKey(id: string): string {
  return `${DOCUMENT_KEY_PREFIX}${id}`
}

/**
 * The slice of `Storage` this adapter uses.
 *
 * Narrowed to four methods so tests can supply a plain object rather than a DOM
 * double — the storage suites run in vitest's `node` environment, where there is no
 * `localStorage` at all.
 */
export interface DocumentStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function ambientStore(): DocumentStore {
  // Read at call time, not at module load: reading `localStorage` during module
  // evaluation would throw in any non-DOM context that merely imports this file,
  // including the MCP build and every node-environment test.
  const store = (globalThis as { localStorage?: DocumentStore }).localStorage
  if (!store) {
    throw telaError('io_failed', 'local document storage is unavailable in this environment')
  }
  return store
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly #store: DocumentStore | undefined

  /** Pass a store to target something other than the ambient `localStorage`. */
  constructor(store?: DocumentStore) {
    this.#store = store
  }

  get #storage(): DocumentStore {
    return this.#store ?? ambientStore()
  }

  /**
   * The library index, projected.
   *
   * The store's own order is preserved rather than sorted here: the library page
   * applies its own filter/sort (recents, scratchpad-first), and re-ordering
   * underneath it would change what the user sees.
   */
  async listDocuments(): Promise<DocumentSummary[]> {
    return useFileStore.getState().files.map((file) => ({
      id: file.id,
      name: file.name,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      folderId: file.folderId,
      ...(file.isScratchpad ? { isScratchpad: true } : {}),
    }))
  }

  async getDocument(id: string): Promise<{ bundle: Uint8Array; contentRevision: string }> {
    const encoded = this.#storage.getItem(documentKey(id))
    if (encoded === null) {
      throw telaError('missing_entry', 'no stored document with that id', id)
    }

    const bundle = base64Decode(encoded)
    // The revision is read out of the bundle's own manifest rather than cached
    // beside it. A cached copy is a second source of truth that can drift from the
    // bytes it describes; this one cannot.
    return { bundle, contentRevision: readBundle(bundle).manifest.contentRevision }
  }

  /**
   * `baseContentRevision` is accepted and ignored: local mode has exactly one
   * writer, so there is no race to lose and `ConflictError` is unreachable here.
   * The parameter stays in the signature because the interface is what workspace
   * mode implements, and callers must already be passing a base for that to work.
   */
  async putDocument(
    id: string,
    bundle: Uint8Array,
    _baseContentRevision: string | null,
  ): Promise<{ contentRevision: string }> {
    // Validate before storing. Storing bytes that cannot be read back would turn a
    // corrupt save into a document that is only discovered to be lost on open.
    // `readBundle` also yields the manifest, so validation costs nothing extra.
    const { manifest } = readBundle(bundle)

    this.#storage.setItem(documentKey(id), base64Encode(bundle))
    return { contentRevision: manifest.contentRevision }
  }

  /**
   * Remove the body, then the index entry.
   *
   * That order matters: the reverse would, if interrupted between the two, leave an
   * unreachable body keyed by an id the index no longer lists — storage that nothing
   * can name and nothing will collect.
   */
  async archiveDocument(id: string): Promise<void> {
    this.#storage.removeItem(documentKey(id))
    const { files, deleteFile } = useFileStore.getState()
    if (files.some((file) => file.id === id)) deleteFile(id)
  }
}
