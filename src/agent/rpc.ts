import { dispatch, getSchema } from './commands'

/**
 * Agent RPC bridge. Lets a parent window (a host app, or an agent harness driving the
 * iframe) run canvas commands over postMessage, and also exposes a direct
 * `window.canvasStudio` handle for same-window scripting / devtools.
 *
 * Wire protocol (both directions tagged with source SOURCE):
 *   in : { source, type:'command', id, command:{ op, ...args } }
 *   out: { source, type:'command-result', id, result:{ ok, result?, error? } }
 *
 * This is an internal tool gated by the host app's auth; we require the SOURCE tag as a
 * light guard rather than pinning an origin (the iframe is same-origin in the host,
 * but a harness may drive it cross-origin). No command mutates auth/permissions,
 * so the blast radius is confined to the current design document.
 */

const SOURCE = 'canvas-studio-agent'

interface CommandMessage {
  source: string
  type: 'command'
  id?: string | number
  command: { op: string; [k: string]: unknown }
}

function isCommandMessage(d: unknown): d is CommandMessage {
  return !!d && typeof d === 'object' && (d as CommandMessage).source === SOURCE && (d as CommandMessage).type === 'command'
}

export function installAgentRpc(): () => void {
  if (typeof window === 'undefined') return () => {}

  // Direct handle: an agent scripting the page (or you, in devtools) can call
  // window.canvasStudio.dispatch({ op:'getSchema' }) without postMessage plumbing.
  ;(window as unknown as { canvasStudio: unknown }).canvasStudio = { dispatch, getSchema }

  const onMessage = async (e: MessageEvent) => {
    if (!isCommandMessage(e.data)) return
    const source = e.source as Window | null
    const result = await dispatch(e.data.command)
    const reply = { source: SOURCE, type: 'command-result', id: e.data.id, result }
    // Reply to whoever asked (parent frame or opener).
    source?.postMessage(reply, { targetOrigin: '*' })
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
