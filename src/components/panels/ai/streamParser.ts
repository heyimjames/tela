// --- Streaming SSE parser for the Canvas AI endpoint ---
//
// Calls the configured AI endpoint (see lib/aiApi.ts), which forwards to your
// LLM provider. The stream is a minimal, provider-agnostic SSE format:
// one `data: {"text": "<delta>"}` line per chunk, a terminal `data: [DONE]`,
// and `data: {"error": "..."}` if generation fails. No provider credential is
// used here.

import { postCanvasAI } from '@/lib/aiApi'

export async function streamAIResponse(options: {
  model: string
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens: number
  onDelta: (text: string) => void
  signal?: AbortSignal
}): Promise<string> {
  const response = await postCanvasAI({
    model: options.model,
    system: options.system,
    messages: options.messages,
    maxTokens: options.maxTokens,
    stream: true,
    signal: options.signal,
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  /** Handle one complete SSE line. Throws only for a provider-reported error. */
  const consume = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const payload = line.slice(6).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const data = JSON.parse(payload) as { text?: unknown; error?: unknown } | null
      // `JSON.parse` yields any JSON value, and a bare `null` payload is valid JSON.
      // Reading `.error` off it throws a TypeError, which is not a SyntaxError and so
      // was rethrown below — one malformed line aborted the whole stream and reported
      // an internal message as if the provider had failed.
      if (typeof data !== 'object' || data === null) return
      if (data.error) throw new Error(String(data.error))
      if (typeof data.text === 'string' && data.text) {
        fullText += data.text
        options.onDelta(data.text)
      }
    } catch (err) {
      // A thrown provider error must surface; a JSON parse failure on a
      // partial chunk must not.
      if (err instanceof Error && err.message && !(err instanceof SyntaxError)) {
        throw err
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Parse SSE events from buffer
    const lines = buffer.split('\n')
    // Keep the last potentially incomplete line
    buffer = lines.pop() ?? ''

    for (const line of lines) consume(line)
  }

  // Flush what the loop held back. The last line is kept out of each pass because it
  // may be half an event, but a stream can also end on a *complete* event whose
  // terminating newline never arrives — dropping that one silently truncated the
  // answer, and swallowed a provider error delivered there entirely. A genuinely
  // half-written event still fails to parse and is still ignored.
  //
  // Deliberately NOT `buffer += decoder.decode()` here. That final flush emits U+FFFD
  // for a dangling multi-byte sequence, which can only append a replacement character
  // to the tail — turning a complete final event followed by a truncated character into
  // an unparseable one. Discarding those bytes is what we want, and it is what omitting
  // the flush does.
  consume(buffer)

  return fullText
}
