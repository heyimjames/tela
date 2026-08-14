/**
 * Per-workspace capability flags.
 *
 * Today there is exactly one, `aiEnabled`, and it is off. The point of this module
 * is the seam, not the feature: a later issue can populate capabilities from a real
 * workspace record without any component learning where the value came from.
 *
 * Three properties this file exists to hold:
 *
 * **Default-deny.** The stored value starts disabled and every conversion path
 * treats a missing, malformed, or non-boolean field as disabled. A capability that
 * defaults to "on when unspecified" is one absent field away from shipping a
 * feature that was never approved.
 *
 * **Local mode is always disabled, and not by convention.** `getWorkspaceCapabilities`
 * short-circuits on `isWorkspaceMode()` before it reads anything, so no code path —
 * not a test helper, not a future bootstrap, not a stale module-level value — can
 * enable AI in the offline payload this app ships inside. Local mode has no
 * workspace, so there is nothing that could legitimately grant the capability.
 *
 * **One config mechanism, not two.** Workspace mode is CLI-510's `VITE_WORKSPACE_MODE`
 * flag, reused rather than re-implemented. A second way to ask "are we in workspace
 * mode?" is a second way to answer it wrong.
 *
 * There is deliberately no setter exposed to the UI and no settings toggle. The flag
 * is server-side state, not a user preference.
 */

import { useSyncExternalStore } from 'react'
import { isWorkspaceMode } from '@/storage'

export interface WorkspaceCapabilities {
  /** Whether this workspace may show AI features at all. Off unless a workspace says otherwise. */
  readonly aiEnabled: boolean
}

/** The capability set every build starts from, and the only one local mode ever has. */
export const DISABLED_CAPABILITIES: WorkspaceCapabilities = Object.freeze({ aiEnabled: false })

/** The shape this module reads off a workspace record. Intentionally partial and
 *  fully optional: the record is server-controlled and may predate any given flag. */
export interface WorkspaceCapabilitySource {
  readonly aiEnabled?: unknown
}

/**
 * Derive capabilities from a workspace record.
 *
 * `=== true` rather than a truthiness check on purpose. The record arrives as parsed
 * JSON from a server; `"false"`, `0`, `{}` and `null` are all values a wire format can
 * produce, and only one of them should ever mean "enabled".
 */
export function capabilitiesFromWorkspace(
  record: WorkspaceCapabilitySource | null | undefined,
): WorkspaceCapabilities {
  return Object.freeze({ aiEnabled: record?.aiEnabled === true })
}

let current: WorkspaceCapabilities = DISABLED_CAPABILITIES
const listeners = new Set<() => void>()

/**
 * The capabilities this session has.
 *
 * The local-mode check comes first and is unconditional — see the module comment.
 */
export function getWorkspaceCapabilities(): WorkspaceCapabilities {
  if (!isWorkspaceMode()) return DISABLED_CAPABILITIES
  return current
}

/**
 * Adopt the capabilities carried by a workspace record.
 *
 * The seam a future workspace bootstrap calls once, after it has loaded the record.
 * It is a no-op outside workspace mode, so a mistaken call in a local build cannot
 * turn anything on.
 */
export function adoptWorkspaceCapabilities(
  record: WorkspaceCapabilitySource | null | undefined,
): void {
  const next = capabilitiesFromWorkspace(record)
  if (next.aiEnabled === current.aiEnabled) return
  current = next
  for (const listener of listeners) listener()
}

/** Drop back to the default-deny state. Tests use this to undo `adoptWorkspaceCapabilities`. */
export function resetWorkspaceCapabilitiesForTests(): void {
  if (current === DISABLED_CAPABILITIES) return
  current = DISABLED_CAPABILITIES
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Subscribe a component to the capability set.
 *
 * `useSyncExternalStore` rather than a plain function call so that a component
 * rendered before the workspace record arrives re-renders when it does, instead of
 * showing a stale gate until something unrelated happens to re-render it.
 * `getWorkspaceCapabilities` is used for both the client and server snapshot: it
 * returns a stable frozen object, and the value is identical either way.
 */
export function useWorkspaceCapabilities(): WorkspaceCapabilities {
  return useSyncExternalStore(subscribe, getWorkspaceCapabilities, getWorkspaceCapabilities)
}
