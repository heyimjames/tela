/**
 * Fetch helper for the optional AI Assist feature.
 *
 * Tela ships with NO backend. The AI panel is a thin client that POSTs
 * to an endpoint you provide, so you can proxy to Anthropic, OpenAI, or any
 * provider from your own server and keep API keys out of the browser. The endpoint
 * itself is configured in `@/ai/endpoint` (`VITE_AI_API_ORIGIN` / `VITE_AI_API_PATH`);
 * when it is unset the AI features stay dormant and the app is fully usable without
 * them. The request/response contract is documented in `docs/ai-endpoint.md`.
 */
import { AiDisabledError } from "@/ai/AiProvider";
import { AI_ENDPOINT_CONFIGURED, CANVAS_AI_ENDPOINT } from "@/ai/endpoint";
import { workspaceAllowsAi } from "@/ai/gate";

export { CANVAS_AI_ENDPOINT } from "@/ai/endpoint";

/**
 * True when an AI endpoint has been configured.
 *
 * Kept as a re-export under its original name so this module's public shape is
 * unchanged; `@/ai/endpoint` is where it is defined. Gate on `isAiEnabled()`, not on
 * this — it is one half of the condition.
 */
export { AI_ENDPOINT_CONFIGURED as AI_ENABLED } from "@/ai/endpoint";

export interface CanvasAIChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CanvasAIRequest {
  model: string;
  system: string;
  messages: CanvasAIChatMessage[];
  maxTokens: number;
  stream?: boolean;
  signal?: AbortSignal;
}

/** POST to the configured AI endpoint. Credentials are included so a same-origin
 *  proxy can use session cookies; a cross-origin proxy must allow them via CORS.
 *
 *  Both halves of the gate are enforced here, at the one function every AI generator
 *  funnels through (`generateCopy`, `generateAdDesign`, `relayoutForFormat` via
 *  `completeCanvasAI`, and the streaming parser). The dispatch gate in
 *  `src/agent/commands.ts` stops the RPC ops that are known to reach AI; this stops
 *  the ones nobody remembered to mark. A gate that covers only the paths wired into
 *  it covers only today's paths.
 *
 *  The halves are read **by name from `@/ai/gate`** rather than recomputed here — the
 *  cycle that once forced a local copy is gone since CLI-534 moved the endpoint flag
 *  into the leaf `@/ai/endpoint`. They are checked as two branches rather than through
 *  `isAiEnabled()` because each half has to produce a *different* error: a workspace
 *  without the capability is refused in the same vocabulary `DisabledAiProvider` uses,
 *  while a build with no endpoint configured is a deployment mistake that should say
 *  so. The conjunction they add up to is still stated in exactly one place. */
export async function postCanvasAI(req: CanvasAIRequest): Promise<Response> {
  if (!workspaceAllowsAi()) {
    throw new AiDisabledError("postCanvasAI");
  }

  if (!AI_ENDPOINT_CONFIGURED) {
    throw new Error(
      "AI Assist is not configured. Set VITE_AI_API_ORIGIN to point at your AI proxy endpoint.",
    );
  }

  const { signal, ...bodyFields } = req;
  const response = await fetch(CANVAS_AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(bodyFields),
    signal,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message);
  }

  return response;
}
