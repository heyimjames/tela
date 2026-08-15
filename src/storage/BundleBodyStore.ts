/**
 * Where a document's bytes actually sit.
 *
 * `LocalStorageAdapter` is the seam the app talks to; this is the seam *underneath*
 * it, one level down, so the adapter can change which store holds bodies without
 * changing `StorageAdapter` — the interface workspace mode implements and which this
 * issue is required to leave alone.
 *
 * Two implementations:
 *
 * - `IndexedDbBodyStore` — the default in a browser. Holds `Uint8Array` natively.
 * - `DocumentStoreBodyStore` — the pre-existing `localStorage` path, kept for
 *   environments without a usable IndexedDB and as the source the migration reads
 *   from. Bodies here are base64, exactly as they were written before this change,
 *   because a stored document must stay readable by the code that stored it.
 *
 * Bytes in, bytes out, on both: an implementation that re-encoded would break the
 * round-trip identity `LocalStorageAdapter` exists to guarantee.
 */

import { base64Encode, base64Decode } from '@/tela/assets'
import { documentKey } from './documentKey'
import { rethrowAsQuotaError, type StorageBackend } from './quota'

/**
 * The slice of `Storage` the `localStorage` path uses.
 *
 * Narrowed to three methods so tests can supply a plain object rather than a DOM
 * double — the storage suites run in vitest's `node` environment, where there is no
 * `localStorage` at all.
 */
export interface DocumentStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A place bundle bodies live, addressed by document id. */
export interface BundleBodyStore {
  /** Which budget applies, so a quota rejection can name the real limit. */
  readonly backend: StorageBackend
  /** The stored bytes, or `null` when this store holds no body for `id`. */
  read(id: string): Promise<Uint8Array | null>
  /** Store `bundle` under `id`, replacing any previous body. */
  write(id: string, bundle: Uint8Array): Promise<void>
  /** Remove the body. Removing one that is not there is not an error. */
  delete(id: string): Promise<void>
}

/**
 * The original path: base64 in a synchronous key-value store.
 *
 * Kept byte-for-byte compatible with what shipped in CLI-510 — same key, same
 * encoding — because bodies written by that build have to remain readable, both to be
 * migrated and to be served directly when IndexedDB is unavailable.
 */
export class DocumentStoreBodyStore implements BundleBodyStore {
  readonly backend: StorageBackend = 'localStorage'
  readonly #store: DocumentStore

  constructor(store: DocumentStore) {
    this.#store = store
  }

  async read(id: string): Promise<Uint8Array | null> {
    const encoded = this.#store.getItem(documentKey(id))
    return encoded === null ? null : base64Decode(encoded)
  }

  async write(id: string, bundle: Uint8Array): Promise<void> {
    try {
      this.#store.setItem(documentKey(id), base64Encode(bundle))
    } catch (error) {
      rethrowAsQuotaError(error, id, this.backend)
    }
  }

  async delete(id: string): Promise<void> {
    this.#store.removeItem(documentKey(id))
  }
}
