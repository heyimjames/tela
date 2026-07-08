// --- Streaming SSE parser for the Canvas AI endpoint ---
//
// Calls the configured AI endpoint (see lib/aiApi.ts), which forwards to your
// LLMClient endpoint. The stream is a minimal, provider-agnostic SSE format:
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

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Parse SSE events from buffer
    const lines = buffer.split('\n')
    // Keep the last potentially incomplete line
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const data = JSON.parse(payload)
        if (data.error) throw new Error(data.error)
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
  }

  return fullText
}
