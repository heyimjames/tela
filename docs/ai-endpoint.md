# AI Assist endpoint contract

Tela's AI panel is a thin client. It never talks to an LLM provider
directly and never holds an API key. Instead it POSTs to an endpoint **you**
run, which you point it at with `VITE_AI_API_ORIGIN` (+ optional
`VITE_AI_API_PATH`, default `/api/tela-ai`). Your endpoint injects the real
provider key server-side and relays the model's output back.

This keeps credentials off the client and lets you use any provider, add auth,
rate-limit, or log usage however you like.

## Request

`POST {VITE_AI_API_ORIGIN}{VITE_AI_API_PATH}`

```jsonc
{
  "model": "claude-opus-4-8",        // model id chosen in the UI
  "system": "You are ...",           // system prompt
  "messages": [                       // conversation so far
    { "role": "user", "content": "Make the headline bigger and blue" }
  ],
  "maxTokens": 4096,
  "stream": true                      // true = SSE stream, false = single JSON
}
```

The client sends `credentials: "include"`, so a same-origin proxy can use
session cookies. A cross-origin proxy must return permissive CORS headers
(including `Access-Control-Allow-Credentials: true`).

## Response

### Streaming (`stream: true`)

Return `Content-Type: text/event-stream` with one JSON object per `data:` line:

```
data: {"text": "Sure"}
data: {"text": ", updating"}
data: {"text": " the headline…"}
data: [DONE]
```

- `{"text": "<delta>"}` — append this text delta to the output.
- `data: [DONE]` — terminates the stream.
- `{"error": "<message>"}` — surface this as an error and stop.

### Non-streaming (`stream: false`)

Return a single JSON object:

```json
{ "text": "Full model response as one string." }
```

## Errors

On failure, respond with a non-2xx status and a JSON body `{"error": "..."}`.
The client shows `error` as the failure message (falling back to the status
code if the body isn't JSON).

## Minimal proxy example (Anthropic, streaming)

```ts
// POST /api/tela-ai  (Node / any framework)
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function handler(req, res) {
  const { model, system, messages, maxTokens } = await req.json();

  res.setHeader("Content-Type", "text/event-stream");
  const stream = await client.messages.stream({
    model,
    system,
    messages,
    max_tokens: maxTokens,
  });

  stream.on("text", (delta) => {
    res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
  });
  stream.on("error", (err) => {
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  });
  await stream.done();
  res.write("data: [DONE]\n\n");
  res.end();
}
```

Swap the provider SDK for OpenAI or anything else — the client only cares about
the SSE / JSON shape above, not which model produced it.
