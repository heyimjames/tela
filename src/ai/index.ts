/**
 * The AI seam: one place that decides whether AI UI may be shown, and one place that
 * decides which provider serves it. Both answer "no" and "the disabled one" today.
 *
 * Components import `useAiUiEnabled` from here and nothing else about AI gating.
 * Seven entry points hand-writing their own condition is seven chances for one of
 * them to drift; one helper is one thing to get right and one thing to test.
 */

import { useMemo } from 'react'
import { AI_ENABLED } from '@/lib/aiApi'
import { DisabledAiProvider, type AiProvider } from './AiProvider'
import { getWorkspaceCapabilities, useWorkspaceCapabilities } from './capabilities'

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
 * Whether any AI entry point may be rendered.
 *
 * Both conditions must hold, and they are different questions:
 *
 * - `aiEnabled` — *is this workspace allowed AI?* Server-side, off by default, and
 *   always false in local mode.
 * - `AI_ENABLED` — *is an endpoint configured for this build?* (`VITE_AI_API_ORIGIN`,
 *   `src/lib/aiApi.ts`.) This condition already gated the dock item and the settings
 *   tabs before this change; it is kept rather than replaced, because dropping it
 *   would let a workspace with the capability render a panel whose only action throws.
 *
 * The composite is narrower than what shipped before on every path, which is the
 * direction a dormant feature's gate should move.
 */
export function isAiUiEnabled(): boolean {
  return getWorkspaceCapabilities().aiEnabled === true && AI_ENABLED
}

/**
 * The hook form. Subscribes to the capability store so a component gates correctly
 * even if the workspace record arrives after it first rendered.
 */
export function useAiUiEnabled(): boolean {
  const capabilities = useWorkspaceCapabilities()
  return useMemo(() => capabilities.aiEnabled === true && AI_ENABLED, [capabilities])
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
