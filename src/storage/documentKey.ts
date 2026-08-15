/**
 * The `localStorage` key a document body is (or was) stored under.
 *
 * Its own module so both `LocalStorageAdapter` and `BundleBodyStore` can use it
 * without importing each other — the adapter owns the body store, so the dependency
 * has to run one way only.
 *
 * `LocalStorageAdapter` re-exports both names: they were part of its public surface
 * before this file existed, and moving a symbol is not a reason to break an importer.
 */

/**
 * Namespace for document bodies.
 *
 * `tela-bundle:` sits alongside the existing `tela-*` cache keys, which matters for
 * the app-reset helpers in `SettingsModal` and `SettingsPage`: both clear every key
 * matching `startsWith('tela-')`, so a reset already removes stored documents too and
 * did not need to learn about this prefix.
 *
 * Since bodies moved to IndexedDB this prefix addresses the *legacy* location — the
 * one the migration drains and the fallback path still writes to when IndexedDB is
 * unavailable.
 */
export const DOCUMENT_KEY_PREFIX = 'tela-bundle:'

export function documentKey(id: string): string {
  return `${DOCUMENT_KEY_PREFIX}${id}`
}

/** The document id a body key addresses, or `null` if the key is not a body key. */
export function documentIdFromKey(key: string): string | null {
  if (!key.startsWith(DOCUMENT_KEY_PREFIX)) return null
  const id = key.slice(DOCUMENT_KEY_PREFIX.length)
  return id.length > 0 ? id : null
}
