/**
 * The seam's load-bearing property: bytes that go in come back out unchanged.
 *
 * The subject is `makeFullCoverageDocument()` — the same maximally-populated
 * fixture the bundle suite uses, carrying assets, fonts, brand, versions, settings
 * and both active pointers. A narrowing adapter would drop one of those and be
 * caught here; a fixture with only pages would not catch anything, because pages
 * are the one thing every candidate design preserved.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { writeBundle, readBundle } from '@/tela/bundle'
import { sha256Hex } from '@/tela/sha256'
import { makeFullCoverageDocument } from '@/tela/__fixtures__/fullCoverage'
import { useFileStore } from '@/store/useFileStore'
import { LocalStorageAdapter, documentKey, DOCUMENT_KEY_PREFIX, type DocumentStore } from '../LocalStorageAdapter'
import type { StorageAdapter } from '../StorageAdapter'

/** A `Storage` slice that keeps its contents where the test can inspect them. */
function fakeStore(): DocumentStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

describe('LocalStorageAdapter', () => {
  let store: ReturnType<typeof fakeStore>
  let adapter: StorageAdapter

  beforeEach(() => {
    store = fakeStore()
    adapter = new LocalStorageAdapter(store)
  })

  it('satisfies the StorageAdapter interface', () => {
    for (const method of ['listDocuments', 'getDocument', 'putDocument', 'archiveDocument'] as const) {
      expect(typeof (adapter as unknown as Record<string, unknown>)[method]).toBe('function')
    }
  })

  describe('round trip', () => {
    it('returns the exact bytes that were stored', async () => {
      // The pre-change path: the writer `exportSessionBundle()` calls. Producing the
      // baseline through the same writer is the point — the claim is that routing
      // through the adapter changes nothing, not that two writers agree.
      const before = writeBundle(makeFullCoverageDocument())

      await adapter.putDocument('doc-1', before, null)
      const { bundle: after } = await adapter.getDocument('doc-1')

      const beforeHash = sha256Hex(before)
      const afterHash = sha256Hex(after)

      // Surfaced for the issue's evidence requirement.
      console.log(`round-trip sha256 pre-adapter : ${beforeHash}`)
      console.log(`round-trip sha256 post-adapter: ${afterHash}`)

      expect(afterHash).toBe(beforeHash)
      expect(Buffer.from(after)).toEqual(Buffer.from(before))
    })

    it('would notice if the bytes changed', async () => {
      // A guard on the guard. If `sha256Hex` were constant, or the comparison above
      // were comparing a value to itself, this would fail — which is what makes the
      // round-trip assertion above evidence rather than decoration.
      const one = writeBundle(makeFullCoverageDocument())
      const other = writeBundle({ ...makeFullCoverageDocument(), name: 'a different document' })
      expect(sha256Hex(other)).not.toBe(sha256Hex(one))
    })

    it('reports the revision recorded in the stored bundle', async () => {
      const bundle = writeBundle(makeFullCoverageDocument())
      const expected = readBundle(bundle).manifest.contentRevision

      const written = await adapter.putDocument('doc-1', bundle, null)
      const read = await adapter.getDocument('doc-1')

      expect(written.contentRevision).toBe(expected)
      expect(read.contentRevision).toBe(expected)
    })

    it('survives a store that only holds strings', async () => {
      // localStorage cannot hold bytes. If the encoding were lossy — a naive
      // String.fromCharCode, say — the round trip above could still pass on ASCII
      // and fail on a real bundle, so assert the stored form really is a string.
      const bundle = writeBundle(makeFullCoverageDocument())
      await adapter.putDocument('doc-1', bundle, null)
      expect(typeof store.map.get(documentKey('doc-1'))).toBe('string')
    })
  })

  describe('storage keys', () => {
    it('namespaces bodies under the document prefix', async () => {
      await adapter.putDocument('doc-1', writeBundle(makeFullCoverageDocument()), null)
      expect([...store.map.keys()]).toEqual([`${DOCUMENT_KEY_PREFIX}doc-1`])
    })

    it('keeps documents separate', async () => {
      const one = writeBundle(makeFullCoverageDocument())
      const other = writeBundle({ ...makeFullCoverageDocument(), name: 'second' })

      await adapter.putDocument('doc-1', one, null)
      await adapter.putDocument('doc-2', other, null)

      expect(Buffer.from((await adapter.getDocument('doc-1')).bundle)).toEqual(Buffer.from(one))
      expect(Buffer.from((await adapter.getDocument('doc-2')).bundle)).toEqual(Buffer.from(other))
    })
  })

  describe('rejections', () => {
    it('refuses to store bytes it could not read back', async () => {
      // A corrupt save that is only discovered on open is a lost document. Failing
      // at write time keeps the previously stored copy intact.
      await expect(adapter.putDocument('doc-1', new Uint8Array([1, 2, 3]), null)).rejects.toThrow()
      expect(store.map.size).toBe(0)
    })

    it('reports a missing document rather than returning empty bytes', async () => {
      await expect(adapter.getDocument('absent')).rejects.toThrow(/no stored document/)
    })

    it('never signals a conflict, whatever base revision is passed', async () => {
      const bundle = writeBundle(makeFullCoverageDocument())
      await adapter.putDocument('doc-1', bundle, null)
      // A stale base that workspace mode would reject outright.
      await expect(adapter.putDocument('doc-1', bundle, 'f'.repeat(64))).resolves.toBeTruthy()
    })
  })

  describe('listDocuments', () => {
    it('projects the library index in its own order', async () => {
      const state = useFileStore.getState()
      const first = state.createFile('First')
      const second = state.createFile('Second')

      const listed = await adapter.listDocuments()
      const ids = listed.map((entry) => entry.id)

      // The library page applies its own sort; re-ordering here would change what
      // the user sees, so the store's order is preserved as-is.
      expect(ids).toEqual(useFileStore.getState().files.map((file) => file.id))
      expect(ids).toContain(first)
      expect(ids).toContain(second)
      expect(listed.find((entry) => entry.id === first)?.name).toBe('First')
    })

    it('marks the scratchpad', async () => {
      const listed = await adapter.listDocuments()
      expect(listed.some((entry) => entry.isScratchpad)).toBe(true)
    })
  })

  describe('archiveDocument', () => {
    it('removes the body and the index entry together', async () => {
      const id = useFileStore.getState().createFile('Doomed')
      await adapter.putDocument(id, writeBundle(makeFullCoverageDocument()), null)

      await adapter.archiveDocument(id)

      expect(store.map.has(documentKey(id))).toBe(false)
      expect(useFileStore.getState().files.some((file) => file.id === id)).toBe(false)
    })

    it('is not an error for an id that was never stored', async () => {
      await expect(adapter.archiveDocument('never-existed')).resolves.toBeUndefined()
    })

    it('still removes the index entry when storage itself throws', async () => {
      // Regression guard. `localStorage` throws outright where storage is denied
      // (private browsing, an iframe without storage permission — how this app is
      // documented to run). Before the seam existed, delete was a pure store update
      // that could not fail; if a body-removal failure could abort it, those users
      // would be unable to delete a file at all, and the confirm dialog would hang.
      const hostile = new LocalStorageAdapter({
        getItem: () => null,
        setItem: () => { throw new Error('storage is disabled') },
        removeItem: () => { throw new Error('storage is disabled') },
      })
      const id = useFileStore.getState().createFile('Deleted under duress')

      await expect(hostile.archiveDocument(id)).resolves.toBeUndefined()
      expect(useFileStore.getState().files.some((file) => file.id === id)).toBe(false)
    })
  })
})
