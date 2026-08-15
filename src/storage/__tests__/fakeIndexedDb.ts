/**
 * An in-memory `IDBFactory`, big enough to run the real `IndexedDbBodyStore` and no
 * bigger.
 *
 * These suites run in vitest's `node` environment, where there is no IndexedDB. The
 * alternative to a double is a dependency (`fake-indexeddb`), which this issue is not
 * permitted to add for a test-only convenience; the alternative to *either* is testing
 * a mock instead of the adapter, which proves nothing about the code that ships.
 *
 * What it models, because `IndexedDbBodyStore` depends on it:
 *
 * - `open()` firing `onupgradeneeded` before `onsuccess`, once, on first creation.
 * - Requests settling **asynchronously** — every callback is dispatched from a
 *   microtask, never inline. Synchronous dispatch would let code that forgets to await
 *   pass here and hang in a browser.
 * - `transaction.oncomplete` firing after the requests in it succeed, and
 *   `transaction.onabort` firing instead when one fails. `IndexedDbBodyStore` resolves
 *   writes on completion precisely because those are different moments.
 * - `put` storing a structured-clone-ish copy, so a caller mutating its buffer
 *   afterwards cannot change what is stored.
 *
 * What it does not model: versions beyond 1, indexes, cursors, key ranges. The store
 * under test uses none of them.
 *
 * `failNextWrite` is how a quota rejection is injected deterministically — the browser
 * condition (an origin genuinely out of disk) cannot be produced in a unit test, but
 * the exception it raises can be, and that exception is the only part of it the app
 * ever sees.
 */

/** The shape a browser throws when the origin is out of room. */
export function quotaExceededError(): Error {
  const error = new Error('The quota has been exceeded.')
  error.name = 'QuotaExceededError'
  return error
}

interface FakeRequest<T> {
  result: T
  error: Error | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onupgradeneeded?: (() => void) | null
  onblocked?: (() => void) | null
}

function copyBytes(value: unknown): unknown {
  if (value instanceof Uint8Array) return new Uint8Array(value)
  return value
}

export interface FakeIndexedDb {
  factory: IDBFactory
  /** The bodies currently stored, by object-store name then key. */
  contents(storeName: string): Map<string, unknown>
  /**
   * Make the next `put` fail with `error` — a quota rejection unless told otherwise.
   *
   * `where` picks how the failure arrives, because browsers do both: a real IndexedDB
   * quota rejection usually aborts the *transaction* while the request itself reports
   * nothing (`'transaction'`), and some failures come back on the request
   * (`'request'`, which also aborts, as a real implementation would). Code that
   * resolved a write on `request.onsuccess` would report the `'transaction'` case as a
   * successful save.
   */
  failNextWrite(error?: Error, where?: 'request' | 'transaction'): void
  /** Make `open()` fail, the way a storage-denied context does. */
  failOpen(fail: boolean): void
  /** Make `clear()` fail, so the reset's best-effort contract can be tested. */
  failClear(error?: Error): void
}

export function createFakeIndexedDb(): FakeIndexedDb {
  const stores = new Map<string, Map<string, unknown>>()
  let created = false
  let openFails = false
  let pendingWriteFailure: Error | null = null
  let pendingWriteFailureWhere: 'request' | 'transaction' = 'transaction'
  let clearFails: Error | null = null

  const settle = (fn: () => void): void => {
    void Promise.resolve().then(fn)
  }

  const objectStore = (name: string, mode: IDBTransactionMode, transaction: FakeTransaction) => ({
    get(key: string) {
      const request: FakeRequest<unknown> = { result: undefined, error: null, onsuccess: null, onerror: null }
      transaction.enqueue(() => {
        request.result = copyBytes(stores.get(name)?.get(key))
        request.onsuccess?.()
      })
      return request
    },
    put(value: unknown, key: string) {
      const request: FakeRequest<unknown> = { result: key, error: null, onsuccess: null, onerror: null }
      transaction.enqueue(() => {
        if (mode !== 'readwrite') throw new Error('write on a readonly transaction')
        const failure = pendingWriteFailure
        if (failure !== null) {
          pendingWriteFailure = null
          transaction.fail(failure)
          if (pendingWriteFailureWhere === 'request') {
            request.error = failure
            request.onerror?.()
          }
          return
        }
        let store = stores.get(name)
        if (store === undefined) {
          store = new Map<string, unknown>()
          stores.set(name, store)
        }
        store.set(key, copyBytes(value))
        request.onsuccess?.()
      })
      return request
    },
    clear() {
      const request: FakeRequest<unknown> = { result: undefined, error: null, onsuccess: null, onerror: null }
      transaction.enqueue(() => {
        if (clearFails !== null) {
          const failure = clearFails
          transaction.fail(failure)
          return
        }
        stores.get(name)?.clear()
        request.onsuccess?.()
      })
      return request
    },
    delete(key: string) {
      const request: FakeRequest<unknown> = { result: undefined, error: null, onsuccess: null, onerror: null }
      transaction.enqueue(() => {
        stores.get(name)?.delete(key)
        request.onsuccess?.()
      })
      return request
    },
  })

  class FakeTransaction {
    error: Error | null = null
    oncomplete: (() => void) | null = null
    onabort: (() => void) | null = null
    #pending = 0
    #aborted = false
    readonly #storeName: string
    readonly #mode: IDBTransactionMode

    constructor(storeName: string, mode: IDBTransactionMode) {
      this.#storeName = storeName
      this.#mode = mode
    }

    objectStore(name: string) {
      return objectStore(name, this.#mode, this)
    }

    enqueue(work: () => void): void {
      this.#pending += 1
      settle(() => {
        if (this.#aborted) return
        work()
        this.#pending -= 1
        // The transaction completes once its last request has settled — the moment
        // `IndexedDbBodyStore` treats a write as durable.
        if (this.#pending === 0 && !this.#aborted) settle(() => { if (!this.#aborted) this.oncomplete?.() })
      })
    }

    fail(error: Error): void {
      this.#aborted = true
      this.error = error
      settle(() => this.onabort?.())
    }

    get storeName(): string {
      return this.#storeName
    }
  }

  const database = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore(name: string) {
      stores.set(name, new Map<string, unknown>())
      return {}
    },
    transaction(names: string[], mode: IDBTransactionMode = 'readonly') {
      return new FakeTransaction(names[0] ?? '', mode)
    },
  }

  const factory = {
    open(_name: string, _version?: number) {
      const request: FakeRequest<unknown> = {
        result: database,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      }
      settle(() => {
        if (openFails) {
          request.error = new Error('storage is not available in this context')
          request.onerror?.()
          return
        }
        if (!created) {
          created = true
          request.onupgradeneeded?.()
        }
        request.onsuccess?.()
      })
      return request
    },
  }

  return {
    factory: factory as unknown as IDBFactory,
    contents: (storeName) => stores.get(storeName) ?? new Map<string, unknown>(),
    failNextWrite: (error = quotaExceededError(), where: 'request' | 'transaction' = 'transaction') => {
      pendingWriteFailure = error
      pendingWriteFailureWhere = where
    },
    failOpen: (fail) => {
      openFails = fail
    },
    failClear: (error = new Error('clear refused')) => {
      clearFails = error
    },
  }
}
