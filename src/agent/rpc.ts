import { dispatch, dispatchPublic, getSchema } from './commands'

/**
 * Agent RPC bridge. Lets a parent window (a host app, or an agent harness driving the
 * iframe) run canvas commands over postMessage, and also exposes a direct
 * `window.tela` handle for same-window scripting / devtools.
 *
 * Wire protocol (both directions tagged with source SOURCE):
 *   in : { source, type:'command', id, command:{ op, ...args } }
 *   out: { source, type:'command-result', id, result:{ ok, result?, error? } }
 *
 * Two guards, because the SOURCE tag alone is not one:
 *
 *  - **Origin.** Any page can frame or `window.open` this app and post a
 *    correctly-tagged message; the tag is attacker-controlled. So the listener
 *    accepts only same-origin senders, plus whatever origins the embedding host
 *    explicitly declares in `window.__TELA_AGENT_ORIGINS__` (a harness driving
 *    the iframe cross-origin is opting in by setting it). Replies go back to the
 *    asking origin rather than `*`.
 *  - **Surface.** postMessage reaches `dispatchPublic`, which resolves only the
 *    editor's public command table. The bridge-only ops (renderOps.ts) are
 *    reachable through `window.tela.dispatch` — same-page only, which is how the
 *    MCP browser bridge calls them via `page.evaluate` — and never over
 *    postMessage. `applyDocument` replaces the whole editing session; a framing
 *    page must not be able to reach it.
 */

const SOURCE = 'tela-agent'

interface CommandMessage {
  source: string
  type: 'command'
  id?: string | number
  command: { op: string; [k: string]: unknown }
}

function isCommandMessage(d: unknown): d is CommandMessage {
  return !!d && typeof d === 'object' && (d as CommandMessage).source === SOURCE && (d as CommandMessage).type === 'command'
}

/** Origins allowed to drive the public command bus over postMessage. */
function allowedOrigins(): Set<string> {
  const declared = (window as unknown as { __TELA_AGENT_ORIGINS__?: unknown }).__TELA_AGENT_ORIGINS__
  const extra = Array.isArray(declared) ? declared.filter((o): o is string => typeof o === 'string') : []
  return new Set([window.location.origin, ...extra])
}

export function installAgentRpc(): () => void {
  if (typeof window === 'undefined') return () => {}

  // Direct handle: an agent scripting the page (or you, in devtools) can call
  // window.tela.dispatch({ op:'getSchema' }) without postMessage plumbing. This
  // handle is same-origin by the DOM's own rules, so it carries the bridge ops.
  ;(window as unknown as { tela: unknown }).tela = { dispatch, getSchema }

  const onMessage = async (e: MessageEvent) => {
    if (!isCommandMessage(e.data)) return
    // `null` is the opaque origin of a sandboxed frame or a data: URL — never trusted.
    if (!e.origin || e.origin === 'null' || !allowedOrigins().has(e.origin)) return
    const source = e.source as Window | null
    const result = await dispatchPublic(e.data.command)
    const reply = { source: SOURCE, type: 'command-result', id: e.data.id, result }
    // Reply to whoever asked (parent frame or opener), at their origin only.
    source?.postMessage(reply, { targetOrigin: e.origin })
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
