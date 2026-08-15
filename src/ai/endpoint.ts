/**
 * The build-time half of the AI gate: *is an endpoint configured for this build?*
 *
 * Tela ships with NO backend. AI features are a thin client that POSTs to an endpoint
 * you provide, so you can proxy to any provider from your own server and keep API keys
 * out of the browser. Configure:
 *
 *   VITE_AI_API_ORIGIN   base origin, e.g. https://your-api.example.com
 *   VITE_AI_API_PATH     request path (default: /api/tela-ai)
 *
 * When `VITE_AI_API_ORIGIN` is unset the AI features stay dormant and the app is fully
 * usable without them. The request/response contract is documented in
 * `docs/ai-endpoint.md`.
 *
 * **This module is a leaf, and that is its job.** It imports nothing from `@/ai` or
 * `@/lib/aiApi`. Before CLI-534 this half lived in `src/lib/aiApi.ts`, which forced
 * `src/ai/index.ts` to import *from* `aiApi` — and that direction made it impossible
 * for `aiApi.ts` to import the resolver back without a cycle, which is precisely why
 * `postCanvasAI` ended up hand-rolling its own copy of the AND. Extracting the half
 * into a leaf removes the cycle at its root, so every caller can reach one resolver.
 *
 * Read at module scope, like the value it replaces: the suites stub `import.meta.env`
 * and then `vi.resetModules()` to re-evaluate the graph, so a module-scope constant is
 * what the harness is built around.
 */

const AI_ORIGIN = (import.meta.env.VITE_AI_API_ORIGIN as string | undefined) ?? ''
const AI_PATH = (import.meta.env.VITE_AI_API_PATH as string | undefined) ?? '/api/tela-ai'

/**
 * True when an AI endpoint has been configured for this build.
 *
 * Not a gate on its own — the workspace capability is the other half. Ask
 * `isAiEnabled()` (`./gate`) rather than reading this directly; the only callers that
 * legitimately read it alone are the ones that must distinguish *which* half is off in
 * order to pick an error message.
 */
export const AI_ENDPOINT_CONFIGURED = AI_ORIGIN !== ''

/** The URL `postCanvasAI` posts to. Meaningless unless `AI_ENDPOINT_CONFIGURED`. */
export const CANVAS_AI_ENDPOINT = `${AI_ORIGIN}${AI_PATH}`
