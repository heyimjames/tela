/**
 * What "the browser is full" looks like, and how the app is told about it.
 *
 * Two things live here because they are one idea: recognising a quota rejection
 * whatever the browser calls it, and turning it into a rejection the UI can already
 * render.
 *
 * ## The budgets this guards
 *
 * - **`localStorage` — ~5 MB per origin, and that is the optimistic reading.** Bodies
 *   stored there are base64 (a 1.33x inflation), and browsers count the quota in
 *   UTF-16 code units, so each base64 character costs two bytes. A 5 MB budget is
 *   therefore closer to **~1.9 MB of actual bundle** — and it is shared with the
 *   library index (`tela-files`), the welcome flag, and every other `tela-*` key. One
 *   design carrying a couple of photographs exceeds it. This is why bundle bodies
 *   moved to IndexedDB (`IndexedDbBodyStore`); `localStorage` remains only as the
 *   fallback for contexts without a usable IndexedDB.
 * - **IndexedDB — origin-scoped and typically hundreds of MB**, derived from free disk
 *   space rather than a fixed constant, and it stores `Uint8Array` natively, so the
 *   base64 hop disappears with it. Large, but not unlimited: a browser under storage
 *   pressure still rejects, and eviction can still reclaim a whole origin. So quota
 *   handling is required on that path too, not only on the fallback.
 *
 * ## Why a subclass of `TelaError` rather than a new error type
 *
 * `describeTelaError` (`src/tela/browserIo.ts`) renders a `TelaError` as
 * `message (detail)` and anything else as bare `error.message`. Subclassing means the
 * save path in `TopBar` shows the actionable text with no UI change at all, while
 * callers that want to branch on *why* a write failed can still test the type. The
 * code is `io_failed` because `src/tela/` — where `TelaErrorCode` is defined — is
 * frozen for this issue, and `io_failed` is the honest existing code for "the store
 * refused the write".
 */

import { TelaError } from '@/tela/errors'

/** Which store refused the write. Carried on the error so a report names the real limit. */
export type StorageBackend = 'indexedDB' | 'localStorage'

/**
 * Is this the browser saying "no room"?
 *
 * Three spellings, because three engines disagree and the app must not care which one
 * the user is running:
 *
 * - `QuotaExceededError` — the standard `DOMException` name (Chrome, Safari, and
 *   modern Firefox, for both `localStorage` and IndexedDB).
 * - `NS_ERROR_DOM_QUOTA_REACHED` / legacy code `1014` — Firefox's own name.
 * - `QUOTA_EXCEEDED_ERR` / legacy code `22` — the legacy `DOMException` code table,
 *   still what older WebKit throws from `localStorage.setItem`.
 *
 * Duck-typed rather than `instanceof DOMException`: this predicate has to work in the
 * node-environment tests, where `DOMException` may be absent and the double throws a
 * plain object shaped like the real thing. Matching on the shape is also what makes a
 * cross-engine claim testable at all — an `instanceof` check could only ever be
 * exercised against the one engine the test happens to run in.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, code } = error as { name?: unknown; code?: unknown }
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    name === 'QUOTA_EXCEEDED_ERR' ||
    code === 22 ||
    code === 1014
  )
}

/**
 * A write was refused because the browser is out of room for this origin.
 *
 * Thrown from `putDocument`, so the save path *rejects* rather than resolving as if it
 * had stored something. That distinction is the whole point: a silently dropped body
 * is a document the user believes is saved and only discovers is gone when they try to
 * open it.
 */
export class StorageQuotaExceededError extends TelaError {
  /** The document whose body did not fit. */
  readonly documentId: string
  /** The store that refused it, and therefore which budget was reached. */
  readonly backend: StorageBackend

  constructor(documentId: string, backend: StorageBackend, cause?: unknown) {
    super(
      'io_failed',
      'this browser has no storage room left for documents',
      `${backend} quota exceeded — free space by deleting documents from the library, ` +
        'or keep this design as the .tela file you exported',
    )
    // Set explicitly rather than inherited, for the reason `ConflictError` documents:
    // a bundler that downlevels class extension can leave `name` as its parent's, and
    // anything matching on the name would then stop recognising this error.
    this.name = 'StorageQuotaExceededError'
    this.documentId = documentId
    this.backend = backend
    if (cause !== undefined) this.cause = cause
  }
}

/**
 * Re-throw `error` as a quota rejection when that is what it is, and unchanged when it
 * is not.
 *
 * Every write path funnels through here so the classification lives in exactly one
 * place; a second copy would be the one that misses Firefox.
 */
export function rethrowAsQuotaError(error: unknown, documentId: string, backend: StorageBackend): never {
  if (error instanceof StorageQuotaExceededError) throw error
  if (isQuotaExceededError(error)) throw new StorageQuotaExceededError(documentId, backend, error)
  throw error
}
