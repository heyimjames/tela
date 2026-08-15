/**
 * Adapter selection.
 *
 * One flag, `VITE_WORKSPACE_MODE`, matching the mechanism the app already uses for
 * `VITE_AI_API_ORIGIN` (`src/ai/endpoint.ts`) rather than introducing a second way to
 * configure the same build. Unset means local, which is what the certified offline
 * payload ships as: workspace mode has to be switched on deliberately, and no
 * absent-variable or typo path can turn it on by accident.
 *
 * Both adapters are imported unconditionally so both are compiled into the bundle.
 * A dynamic import here would make workspace mode a separate chunk fetched at
 * runtime — a network request on a path that is required never to make one.
 */

import { LocalStorageAdapter } from './LocalStorageAdapter'
import { WorkspaceStorageAdapter } from './WorkspaceStorageAdapter'
import type { StorageAdapter } from './StorageAdapter'

export type { StorageAdapter, DocumentSummary } from './StorageAdapter'
export { ConflictError } from './StorageAdapter'
export { LocalStorageAdapter, DOCUMENT_KEY_PREFIX, documentKey } from './LocalStorageAdapter'
export type { DocumentStore, BundleBodyStore } from './BundleBodyStore'
export { WorkspaceStorageAdapter, NotImplementedError } from './WorkspaceStorageAdapter'
/**
 * The quota surface. Exported so a caller can branch on *why* a save failed —
 * "the browser is full" is the one storage failure a user can act on.
 */
export { StorageQuotaExceededError, isQuotaExceededError, type StorageBackend } from './quota'
/**
 * Erasure for the app's "Clear All Data" reset. Bodies live in IndexedDB, which that
 * reset's `localStorage` key sweep cannot reach on its own.
 */
export { clearStoredDocuments } from './reset'

/**
 * Whether workspace mode is switched on.
 *
 * Opt-in by exact value. Anything else — unset, empty, `false`, `0`, or a typo —
 * is local mode. The alternative, treating any non-empty string as truthy, would
 * make `VITE_WORKSPACE_MODE=false` enable workspace mode.
 */
export function isWorkspaceMode(): boolean {
  const raw = (import.meta.env?.VITE_WORKSPACE_MODE as string | undefined) ?? ''
  const value = raw.trim().toLowerCase()
  return value === 'true' || value === '1'
}

let cached: StorageAdapter | null = null

/**
 * The adapter this build talks to. Local unless workspace mode is switched on.
 *
 * Memoized so callers share one instance and the flag cannot be observed to change
 * mid-session — a build-time constant that appeared to flip at runtime would be a
 * confusing bug to chase.
 */
export function getStorageAdapter(): StorageAdapter {
  if (cached === null) {
    cached = isWorkspaceMode() ? new WorkspaceStorageAdapter() : new LocalStorageAdapter()
  }
  return cached
}

/** Drop the memoized adapter. Tests use this to re-select under a changed flag. */
export function resetStorageAdapterForTests(): void {
  cached = null
}
