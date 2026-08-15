/**
 * Erasing stored documents, for the app's "Clear All Data" reset.
 *
 * ## Why this exists
 *
 * The reset in `SettingsModal` and `SettingsPage` deletes every `localStorage` key
 * beginning `tela-` — deliberately narrow, because the app runs as a same-origin
 * iframe inside a host and `localStorage.clear()` would take the host's data with it.
 * While bundle bodies were `tela-bundle:<id>` keys, that sweep deleted the documents
 * as a side effect.
 *
 * Bodies now live in IndexedDB (CLI-527), which that sweep cannot see. Left alone, the
 * reset would clear the library index and the settings while every document survived
 * on disk: absent from the UI, and impossible to delete through it — on a button whose
 * confirm text promises "This will clear all projects, designs, and settings", in an
 * app whose own copy says all data stays in your browser. That is the reset failing at
 * the one thing it is for.
 *
 * ## Why it never rejects
 *
 * The callers are `onClick` handlers that reload the page immediately afterwards. A
 * rejection there is discarded by React (the CLI-510 `ConfirmDeleteModal` lesson) and
 * would leave the user having confirmed a destructive action that then appeared to do
 * nothing at all. So every failure is swallowed and the reset continues: a store that
 * refuses to be cleared must not also prevent the rest of the reset.
 */

import { ambientIndexedDb, IndexedDbBodyStore } from './IndexedDbBodyStore'
import { documentIdFromKey } from './documentKey'
import type { DocumentStore } from './BundleBodyStore'

/** A `localStorage`-shaped store that can be enumerated. */
interface EnumerableDocumentStore extends DocumentStore {
  readonly length: number
  key(index: number): string | null
}

function ambientLocalStorage(): EnumerableDocumentStore | null {
  const store = (globalThis as { localStorage?: EnumerableDocumentStore }).localStorage
  if (!store || typeof store.length !== 'number' || typeof store.key !== 'function') return null
  return store
}

/**
 * Delete every stored document body, from both the current store and the legacy one.
 *
 * Best effort by contract — see the module note. Returns nothing, and never throws.
 *
 * @param store Override the ambient `localStorage`. Tests pass one; the app does not.
 * @param indexedDb Override the ambient IndexedDB. `null` skips the IndexedDB sweep.
 */
export async function clearStoredDocuments(
  store?: EnumerableDocumentStore | null,
  indexedDb?: IDBFactory | null,
): Promise<void> {
  const factory = indexedDb === undefined ? ambientIndexedDb() : indexedDb
  if (factory !== null) {
    try {
      await new IndexedDbBodyStore(factory).clear()
    } catch {
      // Best effort; the legacy sweep below still runs.
    }
  }

  const legacy = store === undefined ? ambientLocalStorage() : store
  if (!legacy) return
  try {
    // Snapshot first: removing while walking `key(i)` shifts the indices and skips
    // entries, which would leave bodies behind in the one place the reset can see.
    const keys: string[] = []
    for (let index = 0; index < legacy.length; index += 1) {
      const key = legacy.key(index)
      if (key !== null && documentIdFromKey(key) !== null) keys.push(key)
    }
    for (const key of keys) legacy.removeItem(key)
  } catch {
    // Best effort.
  }
}
