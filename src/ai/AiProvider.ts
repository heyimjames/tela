/**
 * The shape a future AI provider would implement, and the one implementation that
 * exists today: a provider that refuses.
 *
 * This file describes an interface and nothing else. There is deliberately no SDK
 * import, no `fetch`, no endpoint, no credential handling, and no vendor named
 * anywhere — the app ships inside a payload certified offline, and a provider that
 * could reach a network would have to be reviewed before it was written, not after.
 *
 * `DisabledAiProvider` is not a placeholder to be deleted. It stays as the value the
 * resolver returns whenever no provider is selected, so "AI is off" has a concrete,
 * testable behaviour rather than being a `null` every caller has to remember to check.
 */

/** A single turn in a conversation handed to a provider. */
export interface AiMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** What a caller asks a provider to do. Vendor-neutral by construction: `model` is an
 *  opaque identifier this app never interprets. */
export interface AiRequest {
  readonly model: string
  readonly system: string
  readonly messages: readonly AiMessage[]
  readonly maxTokens: number
  readonly signal?: AbortSignal
}

/** What a provider returns. */
export interface AiResult {
  readonly text: string
}

/**
 * The provider contract.
 *
 * Every method is async so that the disabled implementation fails the same way a
 * real one would — as a rejected promise at the await, not a synchronous throw at
 * the call site. Two implementations that fail in different shapes are two
 * implementations that need different error handling, which defeats the point of
 * having an interface.
 */
export interface AiProvider {
  /** Stable identifier for the selected provider. Used in diagnostics, never sent anywhere. */
  readonly id: string
  /** Whether this provider can actually service a request. Always false for the disabled one. */
  isAvailable(): Promise<boolean>
  /** Produce a single result for the request. */
  generate(request: AiRequest): Promise<AiResult>
  /** Produce a result incrementally. */
  stream(request: AiRequest): AsyncIterable<string>
}

/** The message every disabled path reports. One string so callers can match on it. */
export const AI_DISABLED_MESSAGE = 'AI is not enabled'

/** Thrown (as a rejection) by every `DisabledAiProvider` method. */
export class AiDisabledError extends Error {
  readonly operation: string

  constructor(operation: string) {
    super(`${AI_DISABLED_MESSAGE}: ${operation}`)
    // Set explicitly: a downlevelled class extension can otherwise leave `name` as
    // 'Error', and a caller matching on it would stop recognising this.
    this.name = 'AiDisabledError'
    this.operation = operation
  }
}

/**
 * The provider in every build today.
 *
 * `isAvailable` resolves `false` rather than rejecting — asking whether AI is
 * available is a legitimate question with a legitimate answer, and making it throw
 * would push every caller into a try/catch to learn "no".
 */
export class DisabledAiProvider implements AiProvider {
  readonly id = 'disabled'

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false)
  }

  generate(_request: AiRequest): Promise<AiResult> {
    return Promise.reject(new AiDisabledError('generate'))
  }

  stream(_request: AiRequest): AsyncIterable<string> {
    // Rejects on the first pull rather than when `stream()` is called, so the failure
    // surfaces at the `for await`, which is where a real provider's would surface too.
    return {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        return {
          next: () => Promise.reject(new AiDisabledError('stream')),
        }
      },
    }
  }
}
