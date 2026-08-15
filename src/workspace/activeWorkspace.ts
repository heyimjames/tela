/**
 * Which workspace the storage adapter is pointed at.
 *
 * A leaf with no imports, for one reason: `src/storage/WorkspaceStorageAdapter.ts`
 * needs a workspace id, and the session controller that knows it imports the
 * adapter. Routing the id through the controller would close that loop. This module
 * is the shared bottom both sides can depend on.
 *
 * `null` means "no workspace selected", which is the state before login and after
 * logout. The adapter refuses rather than guessing: there is no sensible default
 * workspace, and picking the first membership would silently write somebody's design
 * into whichever workspace happened to sort first.
 */

let activeWorkspaceId: string | null = null

const listeners = new Set<() => void>()

export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId
}

export function setActiveWorkspaceId(workspaceId: string | null): void {
  if (activeWorkspaceId === workspaceId) {
    return
  }
  activeWorkspaceId = workspaceId
  for (const listener of listeners) {
    listener()
  }
}

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribeActiveWorkspace(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Raised when an adapter call is made with no workspace selected. */
export class NoActiveWorkspaceError extends Error {
  constructor() {
    super('No workspace is selected.')
    this.name = 'NoActiveWorkspaceError'
  }
}

/** The active workspace, or a refusal. Never a guess. */
export function requireActiveWorkspaceId(): string {
  if (activeWorkspaceId === null) {
    throw new NoActiveWorkspaceError()
  }
  return activeWorkspaceId
}
