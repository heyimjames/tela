/**
 * `streamAIResponse` — the SSE parse states (CLI-541).
 *
 * This module had no test at all; CLI-534 disclosed it as one of the two `postCanvasAI`
 * callers running uncovered. What it does is byte-level: it reassembles `data:` lines
 * out of arbitrary `ReadableStream` chunks, and every interesting failure lives at a
 * boundary the chunking chose, not at a boundary the protocol chose. So the harness
 * feeds *chunks*, not messages, and several tests deliver one logical SSE line across
 * two reads on purpose.
 *
 * Mocked at `postCanvasAI` — the same seam `src/agent/__tests__/rpcAiGate.test.ts` uses
 * — for two reasons: it is the real chokepoint (the gate lives there, so a suite that
 * bypassed it would be testing a path the app cannot take), and it keeps this file
 * inside the zero-network contract (CLI-528) with no `fetch` anywhere.
 *
 * Every "nothing was lost / nothing threw" assertion is paired with a positive: the
 * delivered text is asserted equal to a non-empty expectation and the delta count is
 * pinned, so no assertion here can be satisfied by a stream that delivered nothing
 * (the CLI-513 vacuity trap).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const encoder = new TextEncoder()

/** A `Response` whose body yields exactly these chunks, in order, then closes. */
function responseOf(chunks: readonly (string | Uint8Array)[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
        }
        controller.close()
      },
    }),
  )
}

const REQUEST = {
  model: 'test-model',
  system: 'you are a test',
  messages: [{ role: 'user' as const, content: 'hello' }],
  maxTokens: 64,
}

async function load() {
  vi.resetModules()
  const postCanvasAI = vi.fn<(req: unknown) => Promise<Response>>()
  vi.doMock('@/lib/aiApi', async () => {
    const actual = await vi.importActual<typeof import('@/lib/aiApi')>('@/lib/aiApi')
    return { ...actual, postCanvasAI }
  })
  const { streamAIResponse } = await import('@/components/panels/ai/streamParser')
  return { streamAIResponse, postCanvasAI }
}

/** Drive the parser over `chunks` and report everything it produced. */
async function stream(
  chunks: readonly (string | Uint8Array)[],
  options: { signal?: AbortSignal } = {},
) {
  const { streamAIResponse, postCanvasAI } = await load()
  postCanvasAI.mockResolvedValue(responseOf(chunks))
  const deltas: string[] = []
  const text = await streamAIResponse({
    ...REQUEST,
    signal: options.signal,
    onDelta: (d) => deltas.push(d),
  })
  return { text, deltas, postCanvasAI }
}

/** Drive the parser and capture the rejection instead of the result. */
async function streamRejecting(chunks: readonly (string | Uint8Array)[]) {
  const { streamAIResponse, postCanvasAI } = await load()
  postCanvasAI.mockResolvedValue(responseOf(chunks))
  const deltas: string[] = []
  const error = await streamAIResponse({ ...REQUEST, onDelta: (d) => deltas.push(d) }).then(
    () => null,
    (err: unknown) => err,
  )
  return { error, deltas }
}

afterEach(() => {
  vi.doUnmock('@/lib/aiApi')
  vi.resetModules()
})

describe('a well-formed stream', () => {
  it('concatenates the deltas and reports each one exactly once, in order', async () => {
    const { text, deltas } = await stream([
      'data: {"text":"Sure"}\n\n',
      'data: {"text":", updating"}\n\n',
      'data: {"text":" the headline"}\n\n',
      'data: [DONE]\n\n',
    ])

    // Absolute expectation, not a self-comparison: a parser that dropped everything
    // cannot satisfy this, which is what makes the "nothing is lost" tests below mean
    // something.
    expect(text).toBe('Sure, updating the headline')
    expect(deltas).toEqual(['Sure', ', updating', ' the headline'])
  })

  it('forwards the caller request to the chokepoint with stream: true', async () => {
    const controller = new AbortController()
    const { postCanvasAI } = await stream(['data: [DONE]\n\n'], { signal: controller.signal })

    expect(postCanvasAI).toHaveBeenCalledTimes(1)
    expect(postCanvasAI).toHaveBeenCalledWith({
      model: REQUEST.model,
      system: REQUEST.system,
      messages: REQUEST.messages,
      maxTokens: REQUEST.maxTokens,
      stream: true,
      // Passed through so an aborted panel actually cancels the request rather than
      // detaching from a live one.
      signal: controller.signal,
    })
  })

  it('ignores the frame lines that carry no payload', async () => {
    const { text, deltas } = await stream([
      ': keep-alive comment\n',
      'event: message\n',
      '\n',
      'data:\n',
      'data: {"text":"kept"}\n',
      'data: [DONE]\n',
      'retry: 3000\n',
    ])

    expect(text).toBe('kept')
    expect(deltas).toEqual(['kept'])
  })

  it('does not emit a delta for an empty text field', async () => {
    const { text, deltas } = await stream([
      'data: {"text":""}\n',
      'data: {"text":"real"}\n',
      'data: [DONE]\n',
    ])

    // An empty delta is not a UI event; forwarding it would make onDelta fire for a
    // no-op. The real delta still arrives, so this is not "the stream was ignored".
    expect(deltas).toEqual(['real'])
    expect(text).toBe('real')
  })

  it('ignores a non-string text field rather than concatenating it', async () => {
    const { text, deltas } = await stream([
      'data: {"text":42}\n',
      'data: {"text":"only this"}\n',
      'data: [DONE]\n',
    ])

    expect(text).toBe('only this')
    expect(deltas).toEqual(['only this'])
  })
})

describe('chunk boundaries chosen by the transport, not the protocol', () => {
  it('reassembles one SSE line delivered across two reads — once, not twice', async () => {
    const { text, deltas } = await stream([
      'data: {"te',
      'xt":"reassembled"}\n',
      'data: [DONE]\n',
    ])

    expect(text).toBe('reassembled')
    // The count is the assertion: a parser that flushed its buffer per read would
    // deliver this twice, or deliver a truncated first half.
    expect(deltas).toEqual(['reassembled'])
  })

  it('reassembles several events split at arbitrary byte offsets', async () => {
    const full =
      'data: {"text":"one"}\n\ndata: {"text":"two"}\n\ndata: {"text":"three"}\n\ndata: [DONE]\n\n'
    // Every 7-byte slice, so splits land inside keys, inside values, and on newlines.
    const chunks: string[] = []
    for (let i = 0; i < full.length; i += 7) chunks.push(full.slice(i, i + 7))
    expect(chunks.length).toBeGreaterThan(5)

    const { text, deltas } = await stream(chunks)

    expect(text).toBe('onetwothree')
    expect(deltas).toEqual(['one', 'two', 'three'])
  })

  it('reassembles a multi-byte character split across two reads', async () => {
    const line = encoder.encode('data: {"text":"café 😀"}\ndata: [DONE]\n')
    // Split inside the 4-byte emoji: byte 0 of the sequence lands in the first chunk.
    const emojiStart = line.indexOf(0xf0)
    expect(emojiStart).toBeGreaterThan(0)
    const cut = emojiStart + 2

    const { text, deltas } = await stream([line.slice(0, cut), line.slice(cut)])

    // Not a replacement character: `decoder.decode(…, { stream: true })` must be
    // carrying the partial sequence across reads.
    expect(text).toBe('café 😀')
    expect(deltas).toEqual(['café 😀'])
    expect(text).not.toContain('�')
  })

  it('delivers a final event that arrives without its terminating newline', async () => {
    // A complete event whose trailing "\n" never arrives is still a complete event.
    // Held in `buffer` and never flushed, it is silently dropped and the caller gets a
    // truncated answer that looks like a successful one (fixed in this issue).
    const { text, deltas } = await stream(['data: {"text":"first"}\n', 'data: {"text":"last"}'])

    expect(text).toBe('firstlast')
    expect(deltas).toEqual(['first', 'last'])
  })
})

describe('malformed payloads', () => {
  it('skips a non-JSON data line and keeps parsing the rest', async () => {
    const { text, deltas } = await stream([
      'data: {"text":"before"}\n',
      'data: this is not json\n',
      'data: {"text":"after"}\n',
      'data: [DONE]\n',
    ])

    // The surrounding deltas are the point: a SyntaxError must not abort the stream,
    // and must not be reported as a provider error either.
    expect(text).toBe('beforeafter')
    expect(deltas).toEqual(['before', 'after'])
  })

  it('skips a JSON payload that is not an object with text', async () => {
    const { text, deltas } = await stream([
      'data: "just a string"\n',
      'data: [1,2,3]\n',
      'data: null\n',
      'data: {"unrelated":"field"}\n',
      'data: {"text":"survivor"}\n',
      'data: [DONE]\n',
    ])

    expect(text).toBe('survivor')
    expect(deltas).toEqual(['survivor'])
  })

  it('returns the completed deltas when the stream is truncated mid-JSON', async () => {
    const { text, deltas } = await stream(['data: {"text":"kept"}\n', 'data: {"text":"cut off'])

    // A half-written event cannot be parsed, so it is dropped — but everything that
    // did arrive complete is returned, and the caller is not handed a rejection for a
    // connection that simply ended.
    expect(text).toBe('kept')
    expect(deltas).toEqual(['kept'])
  })

  it('returns an empty string for a stream that carried nothing parseable', async () => {
    const { text, deltas } = await stream(['data: {"tex'])

    expect(text).toBe('')
    expect(deltas).toEqual([])
  })

  it('returns an empty string for an immediately closed stream', async () => {
    const { text, deltas } = await stream([])

    expect(text).toBe('')
    expect(deltas).toEqual([])
  })
})

describe('a provider-reported error', () => {
  it('rejects with the provider message', async () => {
    const { error } = await streamRejecting([
      'data: {"error":"rate limit exceeded"}\n',
      'data: [DONE]\n',
    ])

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('rate limit exceeded')
  })

  it('stops the stream — deltas after the error are never delivered', async () => {
    const { error, deltas } = await streamRejecting([
      'data: {"text":"partial"}\n',
      'data: {"error":"generation failed"}\n',
      'data: {"text":"never seen"}\n',
      'data: [DONE]\n',
    ])

    expect((error as Error).message).toBe('generation failed')
    // The delta before the error is asserted present, so "never seen is absent" cannot
    // pass by way of a harness that delivered no deltas at all.
    expect(deltas).toEqual(['partial'])
  })

  it('surfaces an error that arrives on the final unterminated line', async () => {
    // The dropped-tail bug swallowed this one entirely: the caller was handed the
    // partial text as a success while the provider had reported a failure.
    const { error, deltas } = await streamRejecting([
      'data: {"text":"partial"}\n',
      'data: {"error":"failed at the end"}',
    ])

    expect((error as Error).message).toBe('failed at the end')
    expect(deltas).toEqual(['partial'])
  })

  it('ignores an empty error field rather than rejecting with a blank message', async () => {
    const { text, deltas } = await stream([
      'data: {"error":""}\n',
      'data: {"text":"still fine"}\n',
      'data: [DONE]\n',
    ])

    expect(text).toBe('still fine')
    expect(deltas).toEqual(['still fine'])
  })
})

describe('failures before the stream exists', () => {
  it('propagates a rejection from the chokepoint — the gate is not swallowed', async () => {
    const { streamAIResponse, postCanvasAI } = await load()
    const { AI_DISABLED_MESSAGE } = await import('@/ai')
    postCanvasAI.mockRejectedValue(new Error(`${AI_DISABLED_MESSAGE}: postCanvasAI`))

    const onDelta = vi.fn()
    await expect(streamAIResponse({ ...REQUEST, onDelta })).rejects.toThrow(AI_DISABLED_MESSAGE)
    expect(onDelta).not.toHaveBeenCalled()
  })
})
