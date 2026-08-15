/**
 * The live session state, as a hook.
 *
 * In its own file so `WorkspaceGate.tsx` exports only a component — the repo's
 * `react-refresh/only-export-components` rule, and the reason behind it: a module
 * that exports both a component and a plain function loses fast refresh for the
 * component.
 */

import { useSyncExternalStore } from 'react'
import { getWorkspaceState, subscribeWorkspace, type WorkspaceState } from './session'

export function useWorkspaceState(): WorkspaceState {
  // `getWorkspaceState` is passed as the server snapshot too: it returns a stable
  // object identity between changes, so it is safe on both sides and keeps static
  // rendering from tearing.
  return useSyncExternalStore(subscribeWorkspace, getWorkspaceState, getWorkspaceState)
}
