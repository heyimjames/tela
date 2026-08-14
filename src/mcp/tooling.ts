/**
 * The tool registration harness.
 *
 * Every `tela_*` tool goes through `defineTool`, which is what makes the
 * cross-cutting guarantees actually hold rather than depending on 48 authors
 * remembering them:
 *
 *  - **Annotations are required, not optional.** `ToolSpec` demands all four
 *    hints. A tool cannot be registered without stating whether it is read-only,
 *    destructive, idempotent, and open-world.
 *  - **Errors are uniform.** A throw anywhere becomes an `isError` result whose
 *    text is scrubbed and carries a recovery instruction. No handler formats its
 *    own failure, so none of them can forget to scrub.
 *  - **Every call is logged** with a trace id, duration, and outcome — to stderr,
 *    never stdout.
 *  - **Progress and cancellation are plumbed in one place.** The handler receives
 *    a `signal` and a `progress` reporter; the reporter is a no-op when the
 *    client supplied no progress token, so a handler never has to check.
 *
 * Annotations describe; they never enforce. Destructive operations are gated by
 * revision checks and the approved-root policy in code, and would be just as
 * gated if a client ignored every hint.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { describeError } from './errors'
import { log, newTraceId } from './logging'

export interface ToolAnnotationSet {
  /** True only if the tool cannot modify anything: no disk write, no session mutation. */
  readOnlyHint: boolean
  /** True if the tool can overwrite, replace, or archive existing content. */
  destructiveHint: boolean
  /** True if repeating the call with the same arguments leaves the same state. */
  idempotentHint: boolean
  /** True only if the tool reaches beyond this machine. Every tool here is false: there is no network. */
  openWorldHint: boolean
}

export interface ToolContext {
  signal: AbortSignal
  traceId: string
  /** Monotonic progress. A no-op unless the client supplied a progress token. */
  progress: (progress: number, total: number, message?: string) => Promise<void>
}

export interface ToolSpec<Input extends z.ZodType, Output extends z.ZodType> {
  name: string
  title: string
  description: string
  inputSchema: Input
  outputSchema: Output
  annotations: ToolAnnotationSet
  handler: (args: z.output<Input>, context: ToolContext) => Promise<{ text: string; data: z.input<Output> }>
}

/** Names registered on this server, for the "no generic bus is reachable" assertion in tests. */
const registered = new Set<string>()

export function registeredToolNames(): string[] {
  return [...registered].sort()
}

export function resetRegisteredToolNames(): void {
  registered.clear()
}

const NAME_PATTERN = /^tela_[a-z0-9_]+$/

export function defineTool<Input extends z.ZodType, Output extends z.ZodType>(server: McpServer, spec: ToolSpec<Input, Output>): void {
  if (!NAME_PATTERN.test(spec.name)) {
    throw new Error(`tool name "${spec.name}" must match ${NAME_PATTERN} — every tool on this server is tela_-prefixed and action-oriented`)
  }
  registered.add(spec.name)

  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema as never,
      outputSchema: spec.outputSchema as never,
      annotations: spec.annotations,
    },
    (async (args: unknown, ctx: ToolCallContext) => {
      const traceId = newTraceId()
      const started = Date.now()
      const token = ctx.mcpReq._meta?.progressToken

      let lastProgress = -1
      const progress = async (value: number, total: number, message?: string): Promise<void> => {
        if (token === undefined || token === null) return
        // Monotonicity is a protocol requirement, not a nicety: a client that
        // sees progress go backwards has no way to render it.
        if (value <= lastProgress) return
        lastProgress = value
        await ctx.mcpReq
          .notify({ method: 'notifications/progress', params: { progressToken: token, progress: value, total, ...(message ? { message } : {}) } })
          .catch(() => {})
      }

      try {
        const result = await spec.handler(args as z.output<Input>, { signal: ctx.mcpReq.signal, traceId, progress })
        // Parse rather than trust: `structuredContent` must validate against the
        // advertised output schema, and parsing here means a handler that drifts
        // from its own schema fails loudly in tests instead of on a client.
        const data = spec.outputSchema.parse(result.data)
        log({ level: 'info', traceId, event: 'tool.call', tool: spec.name, durationMs: Date.now() - started, outcome: 'ok' })
        return {
          content: [{ type: 'text' as const, text: result.text }],
          structuredContent: data as Record<string, unknown>,
        }
      } catch (cause) {
        const described = describeError(cause)
        log({
          level: described.code === 'cancelled' ? 'info' : 'warn',
          traceId,
          event: 'tool.call',
          tool: spec.name,
          durationMs: Date.now() - started,
          outcome: described.code === 'cancelled' ? 'cancelled' : 'error',
          code: described.code,
          detail: described.message,
        })
        return {
          content: [{ type: 'text' as const, text: `[${described.code}] ${described.message}` }],
          isError: true,
        }
      }
    }) as never,
  )
}

/** The slice of the SDK's server context this harness uses. */
interface ToolCallContext {
  mcpReq: {
    signal: AbortSignal
    _meta?: { progressToken?: string | number }
    notify: (notification: { method: string; params?: Record<string, unknown> }) => Promise<void>
  }
}

/** Annotation presets, so the common cases are stated once and consistently. */
export const READ_ONLY: ToolAnnotationSet = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** Creates or changes state, but never destroys existing content. */
export const ADDITIVE: ToolAnnotationSet = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

/** Can overwrite, replace, or archive. */
export const DESTRUCTIVE: ToolAnnotationSet = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
}

/** Writes, but converges: repeating it with the same arguments lands in the same state. */
export const IDEMPOTENT_WRITE: ToolAnnotationSet = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
