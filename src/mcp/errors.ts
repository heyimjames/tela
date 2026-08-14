/**
 * Tool-facing errors.
 *
 * Two properties matter here and they pull in opposite directions, so they are
 * handled separately rather than traded off:
 *
 *  - **Actionable.** A model that gets "invalid input" has no move. Every error
 *    carries a `recovery` sentence naming the concrete next call. That sentence
 *    is part of the message the client sees, not a field it has to know to read.
 *  - **Scrubbed.** The message must not leak absolute paths, the approved root,
 *    home directories, or document content. `scrub()` is applied to every
 *    outgoing message, including messages produced by code that never heard of
 *    this module (Node `ENOENT` strings, zod issues, Playwright failures).
 *
 * Scrubbing is done at the boundary, once, rather than by asking every call site
 * to remember — a rule that is enforced in one place is a rule that holds.
 */

import { homedir } from 'node:os'

export type ToolErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'revision_mismatch'
  | 'locked'
  | 'not_open'
  | 'already_open'
  | 'policy_refused'
  | 'unsupported'
  | 'bridge_failed'
  | 'cancelled'
  | 'internal'

export class ToolError extends Error {
  readonly code: ToolErrorCode
  readonly recovery: string

  constructor(code: ToolErrorCode, message: string, recovery: string) {
    super(message)
    this.name = 'ToolError'
    this.code = code
    this.recovery = recovery
  }
}

export function toolError(code: ToolErrorCode, message: string, recovery: string): ToolError {
  return new ToolError(code, message, recovery)
}

/** Roots replaced with a stable placeholder rather than deleted, so the shape of the message survives. */
function replacements(): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  const root = process.env.TELA_APPROVED_ROOT
  if (root) pairs.push([root, '<approved-root>'])
  const home = safeHomedir()
  if (home) pairs.push([home, '<home>'])
  if (process.env.TMPDIR) pairs.push([process.env.TMPDIR.replace(/\/$/, ''), '<tmp>'])
  // Longest first: replacing `<home>` before `<approved-root>` would leave a
  // half-scrubbed path when the approved root lives under the home directory.
  return pairs.sort((a, b) => b[0].length - a[0].length)
}

function safeHomedir(): string | undefined {
  try {
    return homedir()
  } catch {
    return undefined
  }
}

/**
 * Remove absolute paths and known roots from a message.
 *
 * The final pass is the load-bearing one: any *remaining* absolute path — a
 * temp dir on a machine whose `TMPDIR` is unset, a Playwright browser path
 * baked into a stack — is collapsed to its basename. Without it, scrubbing
 * would only be as good as the list of roots we happened to think of.
 */
export function scrub(input: string): string {
  let out = input
  for (const [from, to] of replacements()) {
    if (from.length > 1) out = out.split(from).join(to)
  }
  out = out.replace(/(?:[A-Za-z]:)?[\\/](?:[\w .@+-]+[\\/]){1,}[\w .@+-]*/g, (match) => {
    if (match.startsWith('<')) return match
    const parts = match.split(/[\\/]/).filter(Boolean)
    const last = parts[parts.length - 1] ?? ''
    return last ? `<path>/${last}` : '<path>'
  })
  return out
}

/** The single formatter every failing tool call goes through. */
export function describeError(cause: unknown): { code: ToolErrorCode; message: string } {
  if (cause instanceof ToolError) {
    return { code: cause.code, message: scrub(`${cause.message} — ${cause.recovery}`) }
  }
  if (isTelaErrorLike(cause)) {
    return {
      code: mapTelaCode(cause.code),
      message: scrub(
        `${cause.message}${cause.detail ? ` (${cause.detail})` : ''} — the .tela source was refused as [${cause.code}]. ` +
          `Call tela_validate_design on the source to see every violation before retrying.`,
      ),
    }
  }
  if (cause instanceof Error) {
    if (cause.name === 'AbortError') {
      return { code: 'cancelled', message: 'the operation was cancelled by the client — retry the call if the cancellation was not intended' }
    }
    return { code: 'internal', message: scrub(`${cause.message} — this is an internal failure; call tela_get_status to check the runtime, then retry`) }
  }
  return { code: 'internal', message: scrub(`${String(cause)} — this is an internal failure; call tela_get_status to check the runtime, then retry`) }
}

interface TelaErrorLike {
  name: string
  code: string
  message: string
  detail?: string
}

function isTelaErrorLike(value: unknown): value is TelaErrorLike {
  return (
    value instanceof Error &&
    value.name === 'TelaError' &&
    typeof (value as { code?: unknown }).code === 'string'
  )
}

function mapTelaCode(code: string): ToolErrorCode {
  switch (code) {
    case 'io_failed':
      return 'not_found'
    case 'future_schema_version':
    case 'unknown_schema_version':
      return 'unsupported'
    case 'content_revision_mismatch':
      return 'revision_mismatch'
    default:
      return 'invalid_input'
  }
}
