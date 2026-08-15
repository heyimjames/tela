/**
 * The storage harness: the app's real storage modules, in a real browser, against a
 * real IndexedDB.
 *
 * ## Why this page exists rather than driving the editor
 *
 * The property CLI-527 proved by hand and this gate has to keep proving is
 * **byte-identity**: the exact bytes handed to `putDocument` are the exact bytes
 * `getDocument` returns. That cannot be driven through the editor UI, because every
 * UI save re-serialises the document from the live editing state — the bytes that
 * reach storage are produced by the app, so a test driving the UI can only ever
 * compare the app's output to itself. To assert byte-identity the *test* has to own
 * the input bytes, which means calling the adapter directly.
 *
 * So this page is a thin shell over the shipped modules: it imports
 * `getStorageAdapter()` — the same selection function `main.tsx` uses — and
 * `clearStoredDocuments()`, and adds nothing but a way to call them. There is no
 * reimplementation here, no double, and no branch that only tests take. The vitest
 * suite's `fakeIndexedDb` double is exactly what this replaces.
 *
 * The reset buttons are *not* driven from here. Those live on two `onClick` handlers
 * in the real components, so their spec drives the real built app and only uses this
 * page to put something in the store worth erasing.
 *
 * ## What is deliberately not app code
 *
 * The base64 helpers below are local, not `@/tela/assets`. They exist only to carry
 * bytes across the `page.evaluate` boundary, and if the subject's own codec were used
 * for that, a symmetric bug in it would cancel itself out and the round-trip would
 * still look byte-identical. The independent check is the inspector's `crypto.subtle`
 * hash of what actually landed in IndexedDB (`tests/storage/idb.ts`); these helpers
 * only have to be standard base64.
 *
 * ## What this page must never become
 *
 * It is built by its own Vite invocation (`vite.config.ts` beside this file) into the
 * probe's output directory, never into `dist/`. It is not referenced by the app, not
 * an entry in the app's build, and not part of any shipped artifact — `npm run
 * verify:payload` is the standing proof of that.
 */

import { getStorageAdapter, LocalStorageAdapter, resetStorageAdapterForTests } from '@/storage'
import { clearStoredDocuments } from '@/storage/reset'
import { documentKey } from '@/storage/documentKey'
import { isWorkspaceMode } from '@/storage/workspaceMode'
import { StorageQuotaExceededError } from '@/storage/quota'

/**
 * The Storage Buckets API, as much of it as this harness uses.
 *
 * Declared here because the TypeScript DOM lib this repo pins does not carry it yet.
 * Narrow on purpose: a wider hand-written declaration is a second, unchecked copy of
 * a spec, and everything beyond `open`/`delete` would be untested guesswork.
 */
interface StorageBucket {
  readonly indexedDB: IDBFactory
}
interface StorageBucketManager {
  open(name: string, options?: { quota?: number }): Promise<StorageBucket>
  delete(name: string): Promise<void>
}
interface BucketNavigator extends Navigator {
  readonly storageBuckets?: StorageBucketManager
}

/** Standard base64 → bytes. Local on purpose; see the module note. */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** Bytes → standard base64, in chunks so a multi-megabyte body does not blow the stack. */
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/** What a storage call did. Errors are described, never thrown across the boundary. */
export type HarnessResult =
  | { readonly ok: true; readonly contentRevision?: string; readonly base64?: string }
  | {
      readonly ok: false
      readonly name: string
      readonly message: string
      /** Present only on `StorageQuotaExceededError`; names the budget that was hit. */
      readonly backend?: string
      /** `true` only for the app's own quota type, not for anything that merely resembles it. */
      readonly quota: boolean
    }

function describe(error: unknown): HarnessResult {
  if (error instanceof StorageQuotaExceededError) {
    return {
      ok: false,
      name: error.name,
      message: error.message,
      backend: error.backend,
      quota: true,
    }
  }
  const raised = error as { name?: unknown; message?: unknown }
  return {
    ok: false,
    name: typeof raised?.name === 'string' ? raised.name : '<no name>',
    message: typeof raised?.message === 'string' ? raised.message : String(error),
    quota: false,
  }
}

const harness = {
  /**
   * Which build this is. A spec asserts `'local'` before trusting anything below:
   * every claim here is about the default-mode storage path, and a harness
   * accidentally built with `VITE_WORKSPACE_MODE=true` would exercise the API-backed
   * adapter and quietly prove nothing about IndexedDB.
   */
  mode: isWorkspaceMode() ? 'workspace' : 'local',

  /**
   * Drop the memoized adapter, so the next call builds a fresh one.
   *
   * The migration sweep runs once per adapter instance, when its body store is first
   * resolved. Without this a test could only ever observe the sweep that ran on the
   * page's first storage call.
   */
  freshAdapter(): void {
    resetStorageAdapterForTests()
  },

  async put(id: string, base64: string): Promise<HarnessResult> {
    try {
      const { contentRevision } = await getStorageAdapter().putDocument(id, decodeBase64(base64), null)
      return { ok: true, contentRevision }
    } catch (error) {
      return describe(error)
    }
  },

  async get(id: string): Promise<HarnessResult> {
    try {
      const { bundle, contentRevision } = await getStorageAdapter().getDocument(id)
      return { ok: true, base64: encodeBase64(bundle), contentRevision }
    } catch (error) {
      return describe(error)
    }
  },

  /** Whether this browser exposes the Storage Buckets API. See `putUnderQuota`. */
  bucketsAvailable(): boolean {
    return typeof (navigator as BucketNavigator).storageBuckets?.open === 'function'
  },

  /**
   * Write a body through the real adapter into a **storage bucket with a real,
   * small quota**, so the browser itself refuses it.
   *
   * Why a bucket. The point of this call is a *genuine* `QuotaExceededError` — one
   * Chromium's quota manager raised, not a stand-in thrown by a double, because the
   * classifier in `quota.ts` only ever sees what the engine produces. The obvious
   * lever, CDP `Storage.overrideQuotaForOrigin`, is a silent no-op in the pinned
   * Chromium: it returns success, `navigator.storage.estimate()` still reports the
   * disk-derived quota, and a 6 MB write is accepted. A test built on it would have
   * asserted nothing while looking like it asserted everything.
   *
   * A bucket's `indexedDB` is an ordinary `IDBFactory` whose writes are refused when
   * the bucket's quota is reached, with the same `QuotaExceededError` on the same
   * transaction abort as an origin hitting its own budget. `LocalStorageAdapter`
   * already takes a factory — the constructor parameter documented as "target
   * something other than the ambient IndexedDB" — so the subject is the shipped
   * adapter and the shipped `IndexedDbBodyStore`, unmodified, with a store the
   * browser is willing to say no about.
   */
  async putUnderQuota(
    bucketName: string,
    quotaBytes: number,
    id: string,
    base64: string,
  ): Promise<HarnessResult> {
    const buckets = (navigator as BucketNavigator).storageBuckets
    if (buckets === undefined) {
      return { ok: false, name: 'NoStorageBuckets', message: 'this browser has no Storage Buckets API', quota: false }
    }
    try {
      // Dropped first: a bucket keeps the quota it was opened with, so reusing one
      // from an earlier call would silently ignore `quotaBytes`.
      await buckets.delete(bucketName)
      const bucket = await buckets.open(bucketName, { quota: quotaBytes })
      const adapter = new LocalStorageAdapter(undefined, bucket.indexedDB)
      const { contentRevision } = await adapter.putDocument(id, decodeBase64(base64), null)
      return { ok: true, contentRevision }
    } catch (error) {
      return describe(error)
    }
  },

  /** Write a body the way a pre-CLI-527 build did: base64 under `tela-bundle:<id>`. */
  seedLegacyBody(id: string, base64: string): void {
    localStorage.setItem(documentKey(id), base64)
  },

  /** The app's "Clear All Data" erasure, called directly. */
  async clearAll(): Promise<void> {
    await clearStoredDocuments()
  },
}

declare global {
  interface Window {
    __telaStorageHarness?: typeof harness
  }
}

window.__telaStorageHarness = harness

const status = document.getElementById('harness-status')
if (status !== null) status.textContent = `ready:${harness.mode}`
