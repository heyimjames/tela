/**
 * CLI-527: bundle bodies outgrew `localStorage`.
 *
 * Two claims are under test, and they are separable:
 *
 * 1. **Bodies live in IndexedDB now**, byte-identically, with the legacy
 *    `localStorage` copies migrated across and removed — and with `localStorage` still
 *    working as the fallback where IndexedDB will not open.
 * 2. **A full store rejects the save**, as a typed error carrying an actionable
 *    message, on *both* backends. Not a resolved promise, not a hang.
 *
 * The subject is the real `LocalStorageAdapter` throughout, driven against the
 * in-memory `IDBFactory` in `fakeIndexedDb.ts`. Nothing here stubs the adapter's own
 * methods: a test that mocked the thing it is asserting about would pass whatever the
 * shipped code did.
 *
 * The existing `LocalStorageAdapter.test.ts` is untouched and still runs the
 * synchronous path — that path is still real code, still shipped as the fallback.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { writeBundle } from '@/tela/bundle'
import { sha256Hex } from '@/tela/sha256'
import { base64Encode, base64Decode } from '@/tela/assets'
import { describeTelaError } from '@/tela/browserIo'
import { makeFullCoverageDocument } from '@/tela/__fixtures__/fullCoverage'
import { useFileStore } from '@/store/useFileStore'
import { LocalStorageAdapter } from '../LocalStorageAdapter'
import { documentKey } from '../documentKey'
import { BODY_STORE_NAME } from '../IndexedDbBodyStore'
import { StorageQuotaExceededError, isQuotaExceededError } from '../quota'
import type { DocumentStore } from '../BundleBodyStore'
import { createFakeIndexedDb, quotaExceededError, type FakeIndexedDb } from './fakeIndexedDb'

/** A `localStorage` stand-in, enumerable like the real one so the sweep can run. */
function fakeStore(): DocumentStore & { map: Map<string, string>; length: number; key(i: number): string | null } {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

/**
 * Fail loudly if `promise` never settles.
 *
 * The issue's requirement is "not a silent hang", and a hang is invisible to
 * `rejects.toThrow()` — it would surface as the whole file timing out, minutes later,
 * blaming no particular assertion. This turns it into a named failure.
 */
async function settlesWithin<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`did not settle within ${ms}ms — the save hung`)), ms)
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    clearTimeout(timer!)
  }
}

describe('bundle bodies in IndexedDB (CLI-527)', () => {
  let idb: FakeIndexedDb
  let legacy: ReturnType<typeof fakeStore>
  let adapter: LocalStorageAdapter

  beforeEach(() => {
    idb = createFakeIndexedDb()
    legacy = fakeStore()
    adapter = new LocalStorageAdapter(legacy, idb.factory)
  })

  describe('round trip', () => {
    it('returns the exact bytes that were stored', async () => {
      const before = writeBundle(makeFullCoverageDocument())

      await adapter.putDocument('doc-1', before, null)
      const { bundle: after } = await adapter.getDocument('doc-1')

      const beforeHash = sha256Hex(before)
      const afterHash = sha256Hex(after)
      console.log(`indexedDB round-trip sha256 in : ${beforeHash}`)
      console.log(`indexedDB round-trip sha256 out: ${afterHash}`)

      expect(afterHash).toBe(beforeHash)
      expect(Buffer.from(after)).toEqual(Buffer.from(before))
    })

    it('would notice if the bytes changed', () => {
      // The guard on the guard: if `sha256Hex` were constant the assertion above could
      // not fail, and would be decoration rather than evidence.
      const one = writeBundle(makeFullCoverageDocument())
      const other = writeBundle({ ...makeFullCoverageDocument(), name: 'a different document' })
      expect(sha256Hex(other)).not.toBe(sha256Hex(one))
    })

    it('reports the revision recorded in the stored bundle', async () => {
      const bundle = writeBundle(makeFullCoverageDocument())
      const written = await adapter.putDocument('doc-1', bundle, null)
      const read = await adapter.getDocument('doc-1')
      expect(read.contentRevision).toBe(written.contentRevision)
      expect(written.contentRevision).toMatch(/^[0-9a-f]{8,}$/)
    })

    it('stores raw bytes, not base64 — which is the point of the move', async () => {
      const bundle = writeBundle(makeFullCoverageDocument())
      await adapter.putDocument('doc-1', bundle, null)

      const stored = idb.contents(BODY_STORE_NAME).get('doc-1')
      expect(stored).toBeInstanceOf(Uint8Array)
      // Byte-for-byte, so the 1.33x base64 inflation the old path paid is gone. A
      // length assertion alone would pass on a re-encoded body of a similar size.
      expect(Buffer.from(stored as Uint8Array)).toEqual(Buffer.from(bundle))
      expect(base64Encode(bundle).length).toBeGreaterThan(bundle.byteLength)
    })

    it('keeps the body out of localStorage entirely', async () => {
      await adapter.putDocument('doc-1', writeBundle(makeFullCoverageDocument()), null)
      expect([...legacy.map.keys()]).toEqual([])
    })

    it('reports a missing document rather than returning empty bytes', async () => {
      await expect(adapter.getDocument('absent')).rejects.toThrow(/no stored document/)
    })

    it('removes the body and the index entry together', async () => {
      const id = useFileStore.getState().createFile('Doomed')
      await adapter.putDocument(id, writeBundle(makeFullCoverageDocument()), null)

      await adapter.archiveDocument(id)

      expect(idb.contents(BODY_STORE_NAME).has(id)).toBe(false)
      expect(useFileStore.getState().files.some((file) => file.id === id)).toBe(false)
    })
  })

  describe('migration off localStorage', () => {
    it('adopts a legacy body on read, byte-identically, and drops the old copy', async () => {
      const bundle = writeBundle(makeFullCoverageDocument())
      // Exactly what a CLI-510 build left behind.
      legacy.map.set(documentKey('doc-legacy'), base64Encode(bundle))

      const { bundle: read } = await adapter.getDocument('doc-legacy')

      expect(sha256Hex(read)).toBe(sha256Hex(bundle))
      expect(idb.contents(BODY_STORE_NAME).has('doc-legacy')).toBe(true)
      expect(legacy.map.has(documentKey('doc-legacy'))).toBe(false)
    })

    it('drains legacy bodies on first use, without being asked for them', async () => {
      // The load-bearing case. Adoption-on-read alone would leave the bodies of
      // documents the user never reopens sitting in localStorage forever, still
      // consuming the small budget the library index has to fit into — the very quota
      // failure this issue is about, merely relocated.
      const bundle = writeBundle(makeFullCoverageDocument())
      legacy.map.set(documentKey('never-reopened'), base64Encode(bundle))
      legacy.map.set('tela-files', '{"files":[]}')

      // A first operation about an entirely different document.
      await adapter.putDocument('unrelated', writeBundle(makeFullCoverageDocument()), null)

      expect(legacy.map.has(documentKey('never-reopened'))).toBe(false)
      expect(Buffer.from(idb.contents(BODY_STORE_NAME).get('never-reopened') as Uint8Array)).toEqual(
        Buffer.from(bundle),
      )
      // The index is not ours to touch.
      expect(legacy.map.get('tela-files')).toBe('{"files":[]}')
    })

    it('leaves the legacy copy in place when it cannot be migrated', async () => {
      // A body that cannot be moved must not be deleted: the old copy is the only one
      // that exists, and losing it would be losing the document.
      const bundle = writeBundle(makeFullCoverageDocument())
      legacy.map.set(documentKey('doc-legacy'), base64Encode(bundle))
      idb.failNextWrite(new Error('write refused'))

      await adapter.putDocument('unrelated', writeBundle(makeFullCoverageDocument()), null)

      expect(legacy.map.has(documentKey('doc-legacy'))).toBe(true)
      expect(base64Decode(legacy.map.get(documentKey('doc-legacy'))!)).toEqual(bundle)
    })
  })

  describe('falling back to localStorage', () => {
    it('still saves when IndexedDB refuses to open', async () => {
      // Storage-denied contexts expose `indexedDB` and then fail the open. Failing
      // every save there would be a regression against the path that shipped.
      idb.failOpen(true)
      const bundle = writeBundle(makeFullCoverageDocument())

      await settlesWithin(adapter.putDocument('doc-1', bundle, null))

      expect(legacy.map.has(documentKey('doc-1'))).toBe(true)
      expect(Buffer.from((await adapter.getDocument('doc-1')).bundle)).toEqual(Buffer.from(bundle))
    })
  })

  describe('quota', () => {
    it('rejects an over-quota save on IndexedDB, with an actionable message', async () => {
      idb.failNextWrite()
      const bundle = writeBundle(makeFullCoverageDocument())

      const error = await settlesWithin(
        adapter.putDocument('doc-1', bundle, null).then(
          () => null,
          (reason: unknown) => reason,
        ),
      )

      expect(error).toBeInstanceOf(StorageQuotaExceededError)
      const quota = error as StorageQuotaExceededError
      expect(quota.backend).toBe('indexedDB')
      expect(quota.documentId).toBe('doc-1')
      // What the user actually reads, through the app's own renderer.
      const shown = describeTelaError(quota)
      console.log(`user-facing quota message: ${shown}`)
      expect(shown).toMatch(/no storage room left/)
      expect(shown).toMatch(/deleting documents/)
      // And nothing was left behind claiming to be the document.
      expect(idb.contents(BODY_STORE_NAME).has('doc-1')).toBe(false)
    })

    it('rejects an over-quota save on the localStorage fallback too', async () => {
      const full = new LocalStorageAdapter(
        {
          getItem: () => null,
          setItem: () => {
            throw quotaExceededError()
          },
          removeItem: () => {},
        },
        null,
      )

      const error = await settlesWithin(
        full.putDocument('doc-1', writeBundle(makeFullCoverageDocument()), null).then(
          () => null,
          (reason: unknown) => reason,
        ),
      )

      expect(error).toBeInstanceOf(StorageQuotaExceededError)
      expect((error as StorageQuotaExceededError).backend).toBe('localStorage')
    })

    it('does not relabel other storage failures as a full disk', async () => {
      // Without this, `isQuotaExceededError` could return true unconditionally and
      // every test above would still pass — telling users to delete documents when the
      // real fault was something else entirely.
      idb.failNextWrite(new Error('the database is corrupt'))

      const error = await settlesWithin(
        adapter.putDocument('doc-1', writeBundle(makeFullCoverageDocument()), null).then(
          () => null,
          (reason: unknown) => reason,
        ),
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(StorageQuotaExceededError)
    })

    it('recognises every engine spelling of a full store', () => {
      // Chrome/Safari/modern Firefox, Firefox's own name and code, legacy WebKit.
      expect(isQuotaExceededError(quotaExceededError())).toBe(true)
      expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
      expect(isQuotaExceededError({ name: 'NS_ERROR_FAILURE', code: 1014 })).toBe(true)
      expect(isQuotaExceededError({ name: 'QUOTA_EXCEEDED_ERR' })).toBe(true)
      expect(isQuotaExceededError({ name: 'Error', code: 22 })).toBe(true)

      expect(isQuotaExceededError(new Error('disk on fire'))).toBe(false)
      expect(isQuotaExceededError({ name: 'DataError', code: 0 })).toBe(false)
      expect(isQuotaExceededError(null)).toBe(false)
      expect(isQuotaExceededError('QuotaExceededError')).toBe(false)
    })

    it('leaves the previously stored body intact when a later save is refused', async () => {
      // A refused save must not also destroy what was already there.
      const first = writeBundle(makeFullCoverageDocument())
      await adapter.putDocument('doc-1', first, null)

      idb.failNextWrite()
      await expect(
        adapter.putDocument('doc-1', writeBundle({ ...makeFullCoverageDocument(), name: 'bigger' }), null),
      ).rejects.toBeInstanceOf(StorageQuotaExceededError)

      expect(Buffer.from((await adapter.getDocument('doc-1')).bundle)).toEqual(Buffer.from(first))
    })
  })
})
