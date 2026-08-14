/**
 * The disabled provider and the resolver.
 *
 * The method list is derived from the class rather than hand-written, so a method
 * added later without a rejection is a failing test rather than an untested hole.
 */

import { describe, expect, it } from 'vitest'
import {
  AI_DISABLED_MESSAGE,
  AiDisabledError,
  DisabledAiProvider,
  resolveAiProvider,
  type AiRequest,
} from '@/ai'

const request: AiRequest = {
  model: 'unspecified',
  system: 'system',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 16,
}

describe('DisabledAiProvider', () => {
  it('reports itself unavailable rather than throwing', async () => {
    await expect(new DisabledAiProvider().isAvailable()).resolves.toBe(false)
  })

  it('rejects generate with a clear, matchable error', async () => {
    const error = await new DisabledAiProvider().generate(request).then(
      () => null,
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(AiDisabledError)
    expect((error as AiDisabledError).name).toBe('AiDisabledError')
    expect((error as AiDisabledError).operation).toBe('generate')
    expect((error as Error).message).toContain(AI_DISABLED_MESSAGE)
  })

  it('rejects stream on first pull, at the await rather than the call', async () => {
    const provider = new DisabledAiProvider()
    // Calling `stream()` must not throw synchronously — a real provider would not.
    const iterable = provider.stream(request)

    await expect(
      (async () => {
        for await (const chunk of iterable) void chunk
      })(),
    ).rejects.toThrow(AI_DISABLED_MESSAGE)
  })

  it('leaves no method that resolves successfully', async () => {
    const provider = new DisabledAiProvider()
    const methods = Object.getOwnPropertyNames(DisabledAiProvider.prototype).filter(
      (name) =>
        name !== 'constructor' &&
        typeof (provider as unknown as Record<string, unknown>)[name] === 'function',
    )

    // Guards the derivation itself: if the reflection stops finding methods, this
    // test would otherwise pass over an empty list.
    expect(methods.sort()).toEqual(['generate', 'isAvailable', 'stream'])

    for (const name of methods) {
      if (name === 'isAvailable') continue
      const call = (provider as unknown as Record<string, (r: AiRequest) => unknown>)[name](request)
      const settled =
        name === 'stream'
          ? (async () => {
              for await (const chunk of call as AsyncIterable<string>) void chunk
            })()
          : (call as Promise<unknown>)

      await expect(settled, `${name} resolved instead of rejecting`).rejects.toThrow(
        AI_DISABLED_MESSAGE,
      )
    }
  })
})

describe('resolveAiProvider', () => {
  it('returns the disabled provider', () => {
    expect(resolveAiProvider()).toBeInstanceOf(DisabledAiProvider)
    expect(resolveAiProvider().id).toBe('disabled')
  })

  it('returns a stable instance so callers can compare identity', () => {
    expect(resolveAiProvider()).toBe(resolveAiProvider())
  })
})
