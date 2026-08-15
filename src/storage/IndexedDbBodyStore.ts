/**
 * Bundle bodies in IndexedDB.
 *
 * The reason this exists rather than `localStorage`: a `.tela` bundle carrying images
 * routinely exceeds what `localStorage` can hold (see `quota.ts` for the arithmetic —
 * the real ceiling there is under 2 MB of bundle). IndexedDB's budget is derived from
 * free disk space, and it stores `Uint8Array` natively, so the base64 inflation the
 * old path paid disappears along with the limit.
 *
 * The IndexedDB surface used here is deliberately the boring, universally supported
 * subset — `open` with one `onupgradeneeded`, one object store, `get`/`put`/`delete`.
 * No indexes, no cursors, no `getAll`, no key ranges. Every capability not used is a
 * browser difference that cannot bite.
 *
 * Three choices worth stating:
 *
 * - **The database opens lazily, on first use, never in the constructor.**
 *   `getStorageAdapter()` memoizes its adapter at module scope, so a constructor-time
 *   open would fire on import — in the MCP build, in tests, and on any page that
 *   merely touches the module.
 * - **A write resolves on `transaction.oncomplete`, not on `request.onsuccess`.** The
 *   request succeeding only means IndexedDB accepted the value; the transaction
 *   completing is what says it is durable. Quota rejections in particular surface at
 *   transaction abort, so resolving early would report a failed save as a success.
 * - **`onblocked` rejects rather than waiting.** A blocked open never fires
 *   `onsuccess`, so the promise would sit unsettled forever and the save would hang —
 *   the exact failure mode this issue exists to remove.
 */

import { telaError } from '@/tela/errors'
import type { BundleBodyStore } from './BundleBodyStore'
import { rethrowAsQuotaError, type StorageBackend } from './quota'

/** Origin-scoped, and named for the app rather than the feature: there is one. */
export const DATABASE_NAME = 'tela-design'
export const DATABASE_VERSION = 1
/** Keyed by document id — the same id the library index uses. */
export const BODY_STORE_NAME = 'documents'

/**
 * The ambient IndexedDB, or `null` where there is none.
 *
 * Read at call time rather than at module load, for the same reason `ambientStore`
 * does: touching a DOM global during module evaluation throws in every non-DOM
 * context that merely imports this file, including the MCP build.
 */
export function ambientIndexedDb(): IDBFactory | null {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null
}

function requestError(request: { error?: unknown }, what: string): Error {
  const error = request.error
  return error instanceof Error ? error : telaError('io_failed', `indexedDB ${what} failed`)
}

/**
 * Whatever IndexedDB gave back, as bytes.
 *
 * A value written by this class comes back a `Uint8Array`, but a body written by an
 * older or different build could be an `ArrayBuffer`, and structured clone is not
 * required to preserve the exact view type across implementations. Normalising is
 * cheaper than a class of "works everywhere except there" bugs.
 */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw telaError('io_failed', 'the stored document body is not bytes')
}

export class IndexedDbBodyStore implements BundleBodyStore {
  readonly backend: StorageBackend = 'indexedDB'
  readonly #factory: IDBFactory
  #database: Promise<IDBDatabase> | null = null

  constructor(factory: IDBFactory) {
    this.#factory = factory
  }

  /**
   * Open the database, once.
   *
   * A failed open clears the memo so a later call can retry: the usual cause is
   * transient (a storage-denied context that the user then permits), and caching the
   * rejection forever would outlive the condition. `LocalStorageAdapter` calls this
   * before choosing this store, so a browser that cannot open IndexedDB at all falls
   * back to `localStorage` instead of failing every save.
   */
  async ready(): Promise<IDBDatabase> {
    if (this.#database === null) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.#factory.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(BODY_STORE_NAME)) {
            database.createObjectStore(BODY_STORE_NAME)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(requestError(request, 'open'))
        // Another tab holds an older version open. Without this the promise never
        // settles and every save waits on it silently.
        request.onblocked = () => reject(telaError('io_failed', 'indexedDB is blocked by another tab'))
      })
      this.#database = opening.catch((error: unknown) => {
        this.#database = null
        throw error
      })
    }
    return this.#database
  }

  async read(id: string): Promise<Uint8Array | null> {
    const database = await this.ready()
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const transaction = database.transaction([BODY_STORE_NAME], 'readonly')
      const request = transaction.objectStore(BODY_STORE_NAME).get(id)
      request.onsuccess = () => {
        const value: unknown = request.result
        resolve(value === undefined || value === null ? null : toBytes(value))
      }
      request.onerror = () => reject(requestError(request, 'read'))
      transaction.onabort = () => reject(requestError(transaction, 'read transaction'))
    })
  }

  async write(id: string, bundle: Uint8Array): Promise<void> {
    const database = await this.ready()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([BODY_STORE_NAME], 'readwrite')
        const request = transaction.objectStore(BODY_STORE_NAME).put(bundle, id)
        // Resolved on completion, not on the request: only a completed transaction
        // means the bytes are durable, and a quota rejection arrives as an abort.
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(requestError(transaction, 'write transaction'))
        request.onerror = () => reject(requestError(request, 'write'))
      })
    } catch (error) {
      rethrowAsQuotaError(error, id, this.backend)
    }
  }

  /**
   * Drop every body.
   *
   * Exists for the app's "Clear All Data" reset, which sweeps `tela-` keys out of
   * `localStorage` and, before bodies moved here, thereby deleted the documents too.
   * Without this the reset would empty the library index while leaving every document
   * on disk — invisible in the UI and impossible to delete from it.
   *
   * Clears the object store rather than deleting the database: `deleteDatabase` blocks
   * on open connections, and this adapter holds one, so it would hang instead.
   */
  async clear(): Promise<void> {
    const database = await this.ready()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([BODY_STORE_NAME], 'readwrite')
      const request = transaction.objectStore(BODY_STORE_NAME).clear()
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(requestError(transaction, 'clear transaction'))
      request.onerror = () => reject(requestError(request, 'clear'))
    })
  }

  async delete(id: string): Promise<void> {
    const database = await this.ready()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([BODY_STORE_NAME], 'readwrite')
      const request = transaction.objectStore(BODY_STORE_NAME).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(requestError(transaction, 'delete transaction'))
      request.onerror = () => reject(requestError(request, 'delete'))
    })
  }
}
