/**
 * The instrument the storage gate reads: IndexedDB, observed independently of the
 * app.
 *
 * Every function here talks to `indexedDB` directly from `page.evaluate`, using
 * nothing the subject owns — not `IndexedDbBodyStore`, not `LocalStorageAdapter`, not
 * the harness. That separation is the whole point. A test that wrote through the
 * adapter and read back through the adapter would be satisfied by a store that agreed
 * with itself: a `read` that returned its own write buffer, or a `clear` that emptied
 * a cache while the database kept the records, would both pass. And "the store is
 * empty" is the assertion most in need of an independent witness, because a store that
 * was never written to, a database that does not exist, and a database this code
 * cannot open all look identical from the subject's side.
 *
 * So the inspector reports what is *actually* in the `tela-design` database, hashes
 * each record with `crypto.subtle` (a hash the repo did not write), and distinguishes
 * "the database has no records" from "there is no such database" — and
 * `inspector-selftest.spec.ts` makes it prove, on every run, that it can see a seeded
 * record, notice a single flipped byte, and report an empty store after a clear.
 *
 * The names below are duplicated from `src/storage/IndexedDbBodyStore.ts` rather than
 * imported, deliberately: an observer that imported the subject's constants would
 * follow it silently if the app renamed its database, and the gate would keep passing
 * while inspecting a store nothing uses any more. `constants-agree.spec.ts` asserts
 * the two copies match, so a rename is a red test rather than a silent hole.
 */

import type { Page } from '@playwright/test'

/** Must equal `DATABASE_NAME` in `src/storage/IndexedDbBodyStore.ts`. */
export const OBSERVED_DATABASE_NAME = 'tela-design'
/** Must equal `BODY_STORE_NAME` in `src/storage/IndexedDbBodyStore.ts`. */
export const OBSERVED_STORE_NAME = 'documents'
/** Must equal `DOCUMENT_KEY_PREFIX` in `src/storage/documentKey.ts`. */
export const OBSERVED_LEGACY_KEY_PREFIX = 'tela-bundle:'

/** One record, as the browser actually holds it. */
export interface StoredRecord {
  readonly id: string
  readonly byteLength: number
  readonly sha256: string
}

/** What the database looks like from outside the app. */
export interface StoreSnapshot {
  /**
   * `false` when no `tela-design` database exists at all. Kept distinct from an
   * empty record list so a spec can tell "cleared" from "never created", which are
   * the same picture to any code that only counts records.
   */
  readonly databaseExists: boolean
  readonly records: readonly StoredRecord[]
}

/**
 * Read the whole body store.
 *
 * Opens with no version, so it never triggers an upgrade and never creates the
 * database: an inspector that created what it was asked to observe could report a
 * store as "present and empty" when nothing had ever written one.
 */
export async function readStore(page: Page): Promise<StoreSnapshot> {
  return page.evaluate(
    async ([databaseName, storeName]): Promise<StoreSnapshot> => {
      const databases = await indexedDB.databases()
      if (!databases.some((entry) => entry.name === databaseName)) {
        return { databaseExists: false, records: [] }
      }

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('inspector could not open the database'))
        request.onblocked = () => reject(new Error('inspector open was blocked'))
      })

      try {
        if (!database.objectStoreNames.contains(storeName)) {
          return { databaseExists: true, records: [] }
        }

        const transaction = database.transaction([storeName], 'readonly')
        const store = transaction.objectStore(storeName)
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const request = store.getAllKeys()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(new Error('inspector could not list keys'))
        })
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = store.getAll()
          request.onsuccess = () => resolve(request.result as unknown[])
          request.onerror = () => reject(new Error('inspector could not read values'))
        })

        const records: StoredRecord[] = []
        for (let index = 0; index < keys.length; index += 1) {
          const value = values[index]
          const bytes =
            value instanceof Uint8Array
              ? value
              : value instanceof ArrayBuffer
                ? new Uint8Array(value)
                : ArrayBuffer.isView(value)
                  ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
                  : null
          if (bytes === null) {
            // Reported rather than skipped: a body that is not bytes is a real defect
            // and must not read as "no record here".
            records.push({ id: String(keys[index]), byteLength: -1, sha256: '<not-bytes>' })
            continue
          }
          // Copied into a fresh buffer: `digest` rejects a view whose backing buffer
          // is larger than the view, which is exactly what a sub-array is.
          const copy = new Uint8Array(bytes.byteLength)
          copy.set(bytes)
          const digest = await crypto.subtle.digest('SHA-256', copy)
          const hex = Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')
          records.push({ id: String(keys[index]), byteLength: bytes.byteLength, sha256: hex })
        }
        return { databaseExists: true, records }
      } finally {
        database.close()
      }
    },
    [OBSERVED_DATABASE_NAME, OBSERVED_STORE_NAME] as const,
  )
}

/**
 * Write a record straight into the body store, bypassing every app module.
 *
 * Used to seed the state the reset buttons are asked to erase. Seeding through the
 * app's own writer would make the reset tests depend on the writer working, and a
 * reset test must fail for exactly one reason.
 *
 * Creates the object store if the database has none, which is what an ambient app
 * would have done first.
 */
export async function seedRecord(page: Page, id: string, bytes: Uint8Array): Promise<void> {
  await page.evaluate(
    async ([databaseName, storeName, recordId, base64]) => {
      const binary = atob(base64)
      const value = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        value[index] = binary.charCodeAt(index)
      }

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        // Version 1 matches the app's own `DATABASE_VERSION`. Opening at a higher
        // version would leave the app's `open` blocked for the rest of the test.
        const request = indexedDB.open(databaseName, 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('seed could not open the database'))
        request.onblocked = () => reject(new Error('seed open was blocked'))
      })

      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction([storeName], 'readwrite')
          transaction.objectStore(storeName).put(value, recordId)
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(new Error('seed transaction aborted'))
        })
      } finally {
        database.close()
      }
    },
    [OBSERVED_DATABASE_NAME, OBSERVED_STORE_NAME, id, toBase64(bytes)] as const,
  )
}

/**
 * Return the origin to a known-empty state: no `tela-design` database, no
 * `localStorage`.
 *
 * Deleting the database rather than clearing the store, because "the app created it"
 * is itself something a test asserts. `deleteDatabase` blocks on open connections, so
 * this is only safe between navigations — every caller runs it before its `goto`.
 */
export async function resetOrigin(page: Page): Promise<void> {
  await page.evaluate(async ([databaseName]) => {
    localStorage.clear()
    sessionStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('could not delete the database'))
      // A delete blocked by a connection this test cannot see would otherwise hang
      // until the test timed out, with no indication why.
      request.onblocked = () => reject(new Error('database delete was blocked by an open connection'))
    })
  }, [OBSERVED_DATABASE_NAME] as const)
}

/** Every `tela-bundle:` key currently in `localStorage`. */
export async function legacyKeys(page: Page): Promise<string[]> {
  return page.evaluate(([prefix]) => {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key !== null && key.startsWith(prefix)) keys.push(key)
    }
    return keys.sort()
  }, [OBSERVED_LEGACY_KEY_PREFIX] as const)
}

/** Standard base64 of `bytes`, for crossing the Node/page boundary. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** The bytes a base64 string carries. */
export function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}
