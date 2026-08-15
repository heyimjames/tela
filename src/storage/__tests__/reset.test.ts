/**
 * "Clear All Data" has to actually clear the data.
 *
 * The regression this guards against is one CLI-527 created and reflect caught: moving
 * bundle bodies to IndexedDB put them out of reach of the reset's `localStorage` key
 * sweep, so the button emptied the library index and the settings while every design
 * stayed on disk — invisible in the UI, and impossible to delete from it. On a button
 * whose confirm text promises to clear all projects and designs.
 *
 * These tests are about `clearStoredDocuments`, which is where that logic lives
 * precisely so it can be asserted rather than eyeballed inside an `onClick`.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { writeBundle } from '@/tela/bundle'
import { base64Encode } from '@/tela/assets'
import { makeFullCoverageDocument } from '@/tela/__fixtures__/fullCoverage'
import { LocalStorageAdapter } from '../LocalStorageAdapter'
import { clearStoredDocuments } from '../reset'
import { documentKey } from '../documentKey'
import { BODY_STORE_NAME } from '../IndexedDbBodyStore'
import { createFakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb'

function fakeStore() {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

describe('clearStoredDocuments (CLI-527 reset)', () => {
  let idb: FakeIndexedDb
  let store: ReturnType<typeof fakeStore>

  beforeEach(() => {
    idb = createFakeIndexedDb()
    store = fakeStore()
  })

  it('deletes bodies the localStorage sweep cannot see', async () => {
    // Exactly the shape of the bug: a document saved by the current build.
    const adapter = new LocalStorageAdapter(store, idb.factory)
    await adapter.putDocument('doc-1', writeBundle(makeFullCoverageDocument()), null)
    expect(idb.contents(BODY_STORE_NAME).size).toBe(1)

    await clearStoredDocuments(store, idb.factory)

    expect(idb.contents(BODY_STORE_NAME).size).toBe(0)
  })

  it('deletes legacy bodies still sitting in localStorage', async () => {
    store.map.set(documentKey('old-1'), base64Encode(writeBundle(makeFullCoverageDocument())))
    store.map.set(documentKey('old-2'), base64Encode(writeBundle(makeFullCoverageDocument())))

    await clearStoredDocuments(store, idb.factory)

    expect([...store.map.keys()]).toEqual([])
  })

  it('removes every legacy body, not every other one', async () => {
    // Removing while walking `key(i)` shifts the indices and skips entries. With three
    // keys, a naive loop leaves the second behind — and a body left behind is the bug.
    for (const id of ['a', 'b', 'c']) store.map.set(documentKey(id), 'x')

    await clearStoredDocuments(store, idb.factory)

    expect([...store.map.keys()]).toEqual([])
  })

  it('leaves keys that are not document bodies alone', async () => {
    // The reset's own `tela-` sweep owns those; this function must not reach past
    // document bodies into the host page's storage.
    store.map.set('tela-files', '{"files":[]}')
    store.map.set('host-app-session', 'keep me')
    store.map.set(documentKey('doc-1'), 'x')

    await clearStoredDocuments(store, idb.factory)

    expect(store.map.get('tela-files')).toBe('{"files":[]}')
    expect(store.map.get('host-app-session')).toBe('keep me')
    expect(store.map.has(documentKey('doc-1'))).toBe(false)
  })

  it('still clears legacy bodies when IndexedDB refuses', async () => {
    // Best effort by contract: a store that will not be cleared must not also stop the
    // rest of the reset. The caller reloads the page straight afterwards.
    store.map.set(documentKey('old-1'), 'x')
    idb.failClear()

    await expect(clearStoredDocuments(store, idb.factory)).resolves.toBeUndefined()
    expect(store.map.has(documentKey('old-1'))).toBe(false)
  })

  it('never rejects, even with no storage at all', async () => {
    // The callers are `onClick` handlers; a rejection there is discarded by React and
    // the user is left having confirmed a destructive action that did nothing.
    await expect(clearStoredDocuments(null, null)).resolves.toBeUndefined()
  })
})
