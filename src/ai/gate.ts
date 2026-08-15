/**
 * The AI gate — the one place that decides whether AI may run.
 *
 * Two different questions have to both answer yes, and before CLI-534 the app asked
 * them together in three separate places:
 *
 * - `src/ai/index.ts` `isAiEnabled()` — the resolver of record
 * - `src/ai/index.ts` `useAiUiEnabled()` — restated the condition inline in a `useMemo`
 * - `src/lib/aiApi.ts` `postCanvasAI()` — restated both halves inline
 *
 * Three copies of one condition is three chances for one of them to drift, and the
 * third copy existed because of a module cycle rather than a decision: `src/ai/index.ts`
 * imported the endpoint flag *from* `aiApi.ts`, so `aiApi.ts` could not import the
 * resolver back. CLI-534 moved the endpoint half into the leaf `./endpoint`, which lets
 * this module import both halves and lets every caller — UI, agent RPC bus, and the
 * network chokepoint alike — import this one.
 *
 * The two halves, and why both are load-bearing:
 *
 * - **`workspaceAllowsAi`** — *is this workspace allowed AI?* Server-side state, off by
 *   default, and unconditionally false in local mode (see `./capabilities`).
 * - **`AI_ENDPOINT_CONFIGURED`** — *is an endpoint configured for this build?* This half
 *   gated the dock item and the settings tabs before CLI-513 and is kept rather than
 *   replaced: dropping it would let a workspace holding the capability render a panel
 *   whose only action throws.
 *
 * Named for the capability rather than for a surface, because the surface is not the
 * point: CLI-533 established that the agent command bus reaches AI over postMessage
 * without rendering anything, so the RPC gate and the UI gate must answer the same
 * question from the same code.
 */

import { getWorkspaceCapabilities, type WorkspaceCapabilities } from './capabilities'
import { AI_ENDPOINT_CONFIGURED } from './endpoint'

export { AI_ENDPOINT_CONFIGURED } from './endpoint'

/**
 * The workspace half, stated once.
 *
 * `=== true` rather than a truthiness check for the reason `./capabilities` documents:
 * the flag originates as parsed JSON from a server, and only one of the values a wire
 * format can produce should ever mean "enabled".
 *
 * Exported because the callers that must report *which* half is off need to ask for
 * one half by name. It is not a gate — `isAiEnabled()` is.
 */
export function workspaceAllowsAi(
  capabilities: WorkspaceCapabilities = getWorkspaceCapabilities(),
): boolean {
  return capabilities.aiEnabled === true
}

/**
 * The composition, stated once, against an explicit capability set.
 *
 * Takes the capabilities as an argument so the hook form can compose over the set it
 * subscribed to rather than re-reading the store — that is what let `useAiUiEnabled`
 * restate the condition instead of delegating.
 */
export function aiEnabledFor(capabilities: WorkspaceCapabilities): boolean {
  return workspaceAllowsAi(capabilities) && AI_ENDPOINT_CONFIGURED
}

/**
 * Whether AI may run at all in this session — the gate itself, independent of who is
 * asking. Every call site in the app resolves through this or through `aiEnabledFor`.
 */
export function isAiEnabled(): boolean {
  return aiEnabledFor(getWorkspaceCapabilities())
}
