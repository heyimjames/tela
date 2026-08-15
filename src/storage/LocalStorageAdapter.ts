/**
 * The default adapter: documents live in this browser and nowhere else.
 *
 * Two stores back it, and keeping them apart is the whole design:
 *
 * - **The index** is the existing `tela-files` library store (`useFileStore`). It is
 *   read here and mutated only through the store's own actions, so its persisted
 *   bytes, its key, its ordering, and its migrations are exactly what they were
 *   before this seam existed. Nothing about the library page changes.
 * - **The body** is the `.tela` bundle, stored verbatim. Verbatim is load-bearing:
 *   `putDocument` stores the caller's bytes unchanged and `getDocument` hands the same
 *   bytes back, so a save/reload round-trip is byte-identical by construction rather
 *   than by the reader and writer happening to agree. Re-serializing on either side
 *   would make the result depend on the current schema version and producer stamp, and
 *   a document written by an older build would silently change bytes just by being
 *   read.
 *
 * ## Where bodies live, and why that moved (CLI-527)
 *
 * Bodies were `localStorage` values under `tela-bundle:<id>`, base64-encoded. That
 * store cannot hold this product's documents: base64 inflates by 1.33x, browsers count
 * the ~5 MB origin budget in UTF-16 code units, and the budget is shared with the
 * library index — so the real ceiling is under 2 MB of bundle, which one design with a
 * couple of photographs exceeds. `quota.ts` carries the full arithmetic.
 *
 * Bodies now live in **IndexedDB** (`IndexedDbBodyStore`), which holds `Uint8Array`
 * natively and is bounded by disk rather than by a constant. The index stays in
 * `localStorage`, untouched. `StorageAdapter` — the interface workspace mode
 * implements — did not change; neither did this class's methods, its verbatim-bytes
 * contract, or the `tela-bundle:` key, which is still read (and drained) for anything
 * an earlier build stored.
 *
 * Three consequences worth stating plainly:
 *
 * - **`localStorage` remains the fallback.** Where IndexedDB is absent or refuses to
 *   open — a storage-denied iframe, some private-browsing modes — the old path runs
 *   unchanged, with its small budget and its quota error.
 * - **Migration is transparent and best effort.** A legacy body is adopted into
 *   IndexedDB when it is read, and a one-time sweep drains the rest so they stop
 *   occupying the quota the library index needs. Nothing about migration may turn a
 *   working read into a failed one.
 * - **A full store rejects; it never resolves quietly.** `putDocument` throws
 *   `StorageQuotaExceededError`, whose message the existing `describeTelaError`
 *   renders. A save that silently dropped the body would be a document the user
 *   believes is stored and finds missing later.
 *
 * This module and `reset.ts` are the only places in the app that touch a document
 * storage key. The app-reset helpers and the welcome flag elsewhere address
 * non-document keys and are deliberately left where they are.
 *
 * Nothing here opens a network connection. IndexedDB is a platform API, local to the
 * browser profile; the zero-network gate (`tests/network`) covers the built app.
 */

import { readBundle } from '@/tela/bundle'
import { base64Decode } from '@/tela/assets'
import { telaError } from '@/tela/errors'
import { useFileStore } from '@/store/useFileStore'
import type { DocumentSummary, StorageAdapter } from './StorageAdapter'
import { DocumentStoreBodyStore, type BundleBodyStore, type DocumentStore } from './BundleBodyStore'
import { IndexedDbBodyStore, ambientIndexedDb } from './IndexedDbBodyStore'
import { documentIdFromKey, documentKey } from './documentKey'

export type { DocumentStore } from './BundleBodyStore'
export { DOCUMENT_KEY_PREFIX, documentKey } from './documentKey'

/**
 * A `DocumentStore` that can also be enumerated — what the real `localStorage` is.
 *
 * Only the legacy sweep needs this, and only on the ambient path, so it is a
 * capability probed for at runtime rather than a requirement added to `DocumentStore`
 * (which would force every test double to grow two members it does not use).
 */
interface EnumerableDocumentStore extends DocumentStore {
  readonly length: number
  key(index: number): string | null
}

function isEnumerable(store: DocumentStore): store is EnumerableDocumentStore {
  const candidate = store as Partial<EnumerableDocumentStore>
  return typeof candidate.length === 'number' && typeof candidate.key === 'function'
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
  readonly #indexedDb: IDBFactory | null | undefined
  #body: Promise<BundleBodyStore> | null = null

  /**
   * @param store Target something other than the ambient `localStorage`.
   *   Passing one also **pins the synchronous `localStorage` path**: an injected store
   *   is an explicit instruction about where bodies go, and silently routing past it
   *   to the ambient IndexedDB would make the store a caller passed inert.
   * @param indexedDb Target something other than the ambient IndexedDB. `null` forces
   *   the `localStorage` path; omitted means "decide from the environment".
   */
  constructor(store?: DocumentStore, indexedDb?: IDBFactory | null) {
    this.#store = store
    this.#indexedDb = indexedDb
  }

  get #storage(): DocumentStore {
    return this.#store ?? ambientStore()
  }

  /** The ambient IndexedDB, unless the caller pinned a factory or pinned it off. */
  #factory(): IDBFactory | null {
    if (this.#indexedDb !== undefined) return this.#indexedDb
    if (this.#store !== undefined) return null
    return ambientIndexedDb()
  }

  /**
   * Resolve the body store, once, and drain anything the old path left behind.
   *
   * The resolution is async because it is not a guess: the IndexedDB store is only
   * chosen after its database actually opens. A browser that exposes `indexedDB` and
   * then refuses to open it — storage-denied contexts do exactly that — falls back to
   * `localStorage` here rather than failing every subsequent save.
   *
   * A failed resolution is not memoized, so a later call retries.
   */
  #ready(): Promise<BundleBodyStore> {
    if (this.#body === null) {
      const resolving = (async (): Promise<BundleBodyStore> => {
        const factory = this.#factory()
        if (factory !== null) {
          const indexed = new IndexedDbBodyStore(factory)
          try {
            await indexed.ready()
            await this.#drainLegacyBodies(indexed)
            return indexed
          } catch {
            // Fall through to the synchronous path below. Deliberately silent: this is
            // an expected environment difference, not a fault, and the fallback store
            // reports its own failures with its own budget.
          }
        }
        return new DocumentStoreBodyStore(this.#storage)
      })()
      this.#body = resolving.catch((error: unknown) => {
        this.#body = null
        throw error
      })
    }
    return this.#body
  }

  /** The legacy `localStorage`, or `null` where there is none to read. */
  #legacyStore(): DocumentStore | null {
    try {
      return this.#storage
    } catch {
      return null
    }
  }

  /**
   * Move every `tela-bundle:` body an earlier build wrote into `body`, then delete it.
   *
   * Run once, when the IndexedDB path is chosen. Migrating only on read would leave the
   * bodies of documents the user never reopens sitting in `localStorage` forever,
   * consuming the same small budget the library index has to fit in — which is the
   * quota failure this issue is about, merely relocated.
   *
   * Every step is best effort. A body that cannot be decoded, written, or removed is
   * skipped and left exactly where it is: a stale duplicate costs space, whereas a
   * migration that could abort start-up would cost the user their library.
   */
  async #drainLegacyBodies(body: BundleBodyStore): Promise<void> {
    const legacy = this.#legacyStore()
    if (legacy === null || !isEnumerable(legacy)) return

    // Snapshot the keys before removing any: `length` and `key(i)` shift underneath a
    // loop that mutates the store, which would skip entries.
    const keys: string[] = []
    for (let index = 0; index < legacy.length; index += 1) {
      const key = legacy.key(index)
      if (key !== null && documentIdFromKey(key) !== null) keys.push(key)
    }

    for (const key of keys) {
      const id = documentIdFromKey(key)
      if (id === null) continue
      try {
        if ((await body.read(id)) === null) {
          const encoded = legacy.getItem(key)
          if (encoded === null) continue
          await body.write(id, base64Decode(encoded))
        }
        // Reached only when the body is in its new home — either just written, or
        // already there from an earlier partial run.
        legacy.removeItem(key)
      } catch {
        // Best effort; see above.
      }
    }
  }

  /**
   * Read a body the old path wrote, adopt it into `body`, and drop the old copy.
   *
   * The per-document counterpart to the sweep, for the case where the sweep was
   * skipped or failed. Adoption failing does not fail the read: the bytes are already
   * in hand and the caller asked for a document, not for a migration.
   */
  async #adoptLegacyBody(id: string, body: BundleBodyStore): Promise<Uint8Array | null> {
    if (body.backend === 'localStorage') return null
    const legacy = this.#legacyStore()
    if (legacy === null) return null

    const encoded = legacy.getItem(documentKey(id))
    if (encoded === null) return null

    const bundle = base64Decode(encoded)
    try {
      await body.write(id, bundle)
      legacy.removeItem(documentKey(id))
    } catch {
      // Keep the legacy copy: it is the only one that exists.
    }
    return bundle
  }

  /** Drop a superseded legacy copy. Never the reason an operation fails. */
  #forgetLegacyBody(id: string, body: BundleBodyStore): void {
    if (body.backend === 'localStorage') return
    try {
      this.#legacyStore()?.removeItem(documentKey(id))
    } catch {
      // Best effort.
    }
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
    const body = await this.#ready()
    const bundle = (await body.read(id)) ?? (await this.#adoptLegacyBody(id, body))
    if (bundle === null) {
      throw telaError('missing_entry', 'no stored document with that id', id)
    }

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
   *
   * Rejects with `StorageQuotaExceededError` when the browser is out of room. It
   * rejects rather than resolving because the caller's next belief — "this document is
   * stored" — would otherwise be false.
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

    const body = await this.#ready()
    await body.write(id, bundle)
    // Only after the new copy is durable: a legacy body removed first would be a
    // document lost to a write that then failed.
    this.#forgetLegacyBody(id, body)

    return { contentRevision: manifest.contentRevision }
  }

  /**
   * Remove the body, then the index entry.
   *
   * That order matters: the reverse would, if interrupted between the two, leave an
   * unreachable body keyed by an id the index no longer lists.
   *
   * The body removal is best effort and deliberately cannot abort the index
   * removal. Storage throws outright in a storage-restricted context — private
   * browsing, or an iframe denied storage, which is exactly how this app is
   * documented to run — and before this seam existed, deleting a file was a pure
   * store update that could not fail. Letting a body-removal failure propagate would
   * mean a user in that context could never delete a file: a regression created by
   * routing delete through storage at all. A stranded body is inert — ids are
   * unique so nothing reuses the key, and the app's "Clear All Data" reset drops
   * every stored body through `clearStoredDocuments` (`reset.ts`), which reaches
   * IndexedDB as well as the legacy `tela-` keys.
   *
   * Resolving the body store is inside the same guard, because resolving it is itself
   * a storage operation that a hostile environment can fail.
   */
  async archiveDocument(id: string): Promise<void> {
    try {
      const body = await this.#ready()
      await body.delete(id)
      this.#forgetLegacyBody(id, body)
    } catch {
      // Deliberately swallowed; see above. The index removal below is what the user
      // asked for and it must happen.
    }
    const { files, deleteFile } = useFileStore.getState()
    if (files.some((file) => file.id === id)) deleteFile(id)
  }
}
