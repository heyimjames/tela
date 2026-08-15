/**
 * The AI seam: one place that decides whether AI UI may be shown, and one place that
 * decides which provider serves it. Both answer "no" and "the disabled one" today.
 *
 * Components import `useAiUiEnabled` from here and nothing else about AI gating.
 * Seven entry points hand-writing their own condition is seven chances for one of
 * them to drift; one helper is one thing to get right and one thing to test.
 */

import { useMemo } from 'react'
import { DisabledAiProvider, type AiProvider } from './AiProvider'
import { useWorkspaceCapabilities } from './capabilities'
import { aiEnabledFor, isAiEnabled } from './gate'

export type {
  AiMessage,
  AiProvider,
  AiRequest,
  AiResult,
} from './AiProvider'
export { AI_DISABLED_MESSAGE, AiDisabledError, DisabledAiProvider } from './AiProvider'
export type { WorkspaceCapabilities, WorkspaceCapabilitySource } from './capabilities'
export {
  DISABLED_CAPABILITIES,
  adoptWorkspaceCapabilities,
  capabilitiesFromWorkspace,
  getWorkspaceCapabilities,
  resetWorkspaceCapabilitiesForTests,
  useWorkspaceCapabilities,
} from './capabilities'

/**
 * The gate, re-exported from `./gate` — which is where the condition is stated, once.
 *
 * Both halves must hold and they are different questions (*is this workspace allowed
 * AI?* and *is an endpoint configured for this build?*); `./gate` documents them and
 * owns the AND. CLI-534 collapsed three separate statements of that AND — here, in the
 * hook below, and in `postCanvasAI` — into that one module.
 */
export { AI_ENDPOINT_CONFIGURED, aiEnabledFor, isAiEnabled, workspaceAllowsAi } from './gate'

/**
 * Whether any AI entry point may be rendered.
 *
 * Identical to `isAiEnabled` and deliberately kept as its own name: components read
 * a UI-shaped question, and the CLI-513 entry-point suite asserts on this name. It
 * delegates rather than restating the condition.
 */
export function isAiUiEnabled(): boolean {
  return isAiEnabled()
}

/**
 * The hook form. Subscribes to the capability store so a component gates correctly
 * even if the workspace record arrives after it first rendered.
 *
 * Composes through `aiEnabledFor` over the set it subscribed to, rather than restating
 * the condition: taking the capabilities as an argument is what lets the hook delegate
 * and still avoid re-reading the store.
 */
export function useAiUiEnabled(): boolean {
  const capabilities = useWorkspaceCapabilities()
  return useMemo(() => aiEnabledFor(capabilities), [capabilities])
}

const disabled = new DisabledAiProvider()

/**
 * Select the provider for this session.
 *
 * The seam: when a real provider lands, it is selected *here*, behind
 * `isAiUiEnabled()`, and nowhere else. Returning a shared instance keeps identity
 * stable so callers can compare against it.
 */
export function resolveAiProvider(): AiProvider {
  return disabled
}
