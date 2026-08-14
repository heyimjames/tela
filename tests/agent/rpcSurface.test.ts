/**
 * Regression cover for the split command bus.
 *
 * The editor exposes two dispatch surfaces and the difference between them is a
 * security boundary, not an implementation detail:
 *
 *  - `window.tela.dispatch` — **same-page only**. Reaching it requires script
 *    running in this document, which the DOM already gates by origin. It carries
 *    the bridge ops (`renderDocument`, `applyDocument`) because that is how the
 *    MCP browser bridge drives the renderer through `page.evaluate`.
 *  - `dispatchPublic`, behind the postMessage listener — reachable by **any page
 *    that frames or opens this app**. The `source: 'tela-agent'` tag is
 *    attacker-controlled and is therefore not a guard at all.
 *
 * `applyDocument` replaces the entire editing session. A page that framed the
 * editor being able to call it would let it silently swap the user's open design
 * for one of its own. So the boundary is enforced by *table separation* rather
 * than by a name check, and this file is the proof.
 *
 * These run under the node environment with a minimal `window` stub rather than
 * jsdom: the listener only needs `location.origin` and the event-listener pair,
 * and driving the registered handler directly makes the origin and reply
 * assertions exact instead of dependent on a DOM implementation's own
 * postMessage semantics.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { dispatch, dispatchPublic, getSchema } from '../../src/agent/commands'
import { installAgentRpc } from '../../src/agent/rpc'

const HOST_ORIGIN = 'https://tela.local'

/** Ops that must never be reachable from a framing page. */
const BRIDGE_ONLY_OPS = ['renderDocument', 'applyDocument'] as const

type Listener = (event: MessageEvent) => void

interface Reply {
  message: { source: string; type: string; id?: string | number; result: { ok: boolean; result?: unknown; error?: string } }
  options: { targetOrigin: string }
}

interface Stub {
  /** Deliver a message event to the installed listener. */
  post: (data: unknown, origin: string) => Promise<void>
  replies: Reply[]
  /** Run the installer's own teardown, leaving the window stub in place. */
  removeListener: () => void
  uninstall: () => void
}

let stub: Stub

function installWindowStub(declaredOrigins?: string[]): Stub {
  const listeners = new Set<Listener>()
  const replies: Reply[] = []

  const sender = {
    postMessage: (message: Reply['message'], options: Reply['options']) => {
      replies.push({ message, options })
    },
  }

  const win: Record<string, unknown> = {
    location: { origin: HOST_ORIGIN },
    addEventListener: (type: string, handler: Listener) => {
      if (type === 'message') listeners.add(handler)
    },
    removeEventListener: (type: string, handler: Listener) => {
      if (type === 'message') listeners.delete(handler)
    },
  }
  if (declaredOrigins) win.__TELA_AGENT_ORIGINS__ = declaredOrigins
  ;(globalThis as { window?: unknown }).window = win

  const remove = installAgentRpc()

  return {
    replies,
    post: async (data: unknown, origin: string) => {
      const event = { data, origin, source: sender } as unknown as MessageEvent
      // The listener is async; awaiting every registered handler is what makes
      // "no reply was sent" a real assertion rather than a race.
      await Promise.all([...listeners].map((listener) => listener(event)))
    },
    removeListener: remove,
    uninstall: () => {
      remove()
      delete (globalThis as { window?: unknown }).window
    },
  }
}

/** The reply a genuinely nonexistent op produces. Bridge ops must be indistinguishable from this. */
const UNKNOWN_OP = /^Unknown command "/

function commandMessage(op: string, extra: Record<string, unknown> = {}, id: string | number = 1) {
  return { source: 'tela-agent', type: 'command', id, command: { op, ...extra } }
}

beforeEach(() => {
  stub = installWindowStub()
})

afterEach(() => {
  stub.uninstall()
})

describe('postMessage cannot reach the bridge ops', () => {
  it.each(BRIDGE_ONLY_OPS)('does not execute "%s" and gives no reply revealing that it exists', async (op) => {
    await stub.post(commandMessage(op, { document: { pages: [] } }), HOST_ORIGIN)

    expect(stub.replies).toHaveLength(1)
    const { result } = stub.replies[0].message
    expect(result.ok).toBe(false)
    // No result payload leaked back.
    expect(result.result).toBeUndefined()

    // The refusal must be *the same* refusal a nonexistent op gets. Anything
    // more specific — "not available over postMessage", a permissions message —
    // would be an oracle telling a framing page the op exists and is worth
    // attacking another way.
    expect(result.error).toMatch(UNKNOWN_OP)
    await stub.post(commandMessage('opThatDoesNotExistAnywhere', {}, 2), HOST_ORIGIN)
    const control = stub.replies[1].message.result.error!
    expect(result.error!.replace(op, 'X')).toBe(control.replace('opThatDoesNotExistAnywhere', 'X'))
  })

  it('leaves the editing session untouched when applyDocument arrives over postMessage', async () => {
    const { useWorkspaceStore } = await import('../../src/store/useWorkspaceStore')
    const before = useWorkspaceStore.getState().workspace

    await stub.post(
      commandMessage('applyDocument', {
        document: { schemaVersion: 1, id: 'hostile', name: 'Hostile swap', pages: [] },
      }),
      HOST_ORIGIN,
    )

    // Not merely "returned an error" — the store is byte-for-byte the same
    // object, so nothing partially applied on the way to the refusal.
    expect(useWorkspaceStore.getState().workspace).toBe(before)
    expect(useWorkspaceStore.getState().workspace.name).not.toBe('Hostile swap')
  })

  it('omits the bridge ops from the schema a framing page can read', async () => {
    await stub.post(commandMessage('getSchema'), HOST_ORIGIN)
    const ops = (stub.replies[0].message.result.result as { commands: Array<{ op: string }> }).commands.map((entry) => entry.op)
    for (const op of BRIDGE_ONLY_OPS) expect(ops).not.toContain(op)
    // The public surface still works, so this is a boundary and not an outage.
    expect(ops).toContain('getState')
  })

  it('keeps the bridge ops out of the public dispatch table entirely', async () => {
    for (const op of BRIDGE_ONLY_OPS) {
      const result = await dispatchPublic({ op })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(UNKNOWN_OP)
    }
    const publicOps = (getSchema() as { commands: Array<{ op: string }> }).commands.map((entry) => entry.op)
    expect(publicOps).not.toContain('applyDocument')
  })

  it('is not fooled by a prototype-chain lookup of an inherited property name', async () => {
    // `table[op]` without an own-property check would resolve "constructor",
    // "toString", and friends to Object.prototype members and then call them.
    for (const op of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const result = await dispatchPublic({ op })
      expect(result.ok, `"${op}" resolved through the prototype chain`).toBe(false)
      expect(result.error).toMatch(UNKNOWN_OP)
    }
  })
})

describe('same-page window.tela.dispatch can reach the bridge ops', () => {
  it('exposes a dispatch handle on window', () => {
    const handle = (globalThis as { window?: { tela?: { dispatch?: unknown; getSchema?: unknown } } }).window?.tela
    expect(typeof handle?.dispatch).toBe('function')
    expect(typeof handle?.getSchema).toBe('function')
  })

  it.each(BRIDGE_ONLY_OPS)('resolves "%s" — the failure is the op\'s own, not "unknown command"', async (op) => {
    // Called with deliberately invalid input so no browser is needed. What is
    // being asserted is *resolution*: the op ran and rejected the arguments,
    // which is a categorically different answer from the postMessage path's
    // "this command does not exist".
    const viaWindow = (globalThis as unknown as { window: { tela: { dispatch: typeof dispatch } } }).window.tela.dispatch
    const result = await viaWindow({ op })
    expect(result.ok).toBe(false)
    expect(result.error).not.toMatch(UNKNOWN_OP)
  })

  it('actually executes applyDocument with a valid document', async () => {
    const { createDocument } = await import('../../src/mcp/documentOps')
    const { useWorkspaceStore } = await import('../../src/store/useWorkspaceStore')
    const document = createDocument({ name: 'Same-page apply' })

    const result = await dispatch({ op: 'applyDocument', document })
    expect(result.ok).toBe(true)
    expect((result.result as { pages: number }).pages).toBe(1)
    // The session really was replaced — this is the capability postMessage is
    // denied, demonstrated working through the same-page handle.
    expect(useWorkspaceStore.getState().workspace.name).toBe('Same-page apply')
  })

  it('reaches the public ops too, so the bridge table is a superset', async () => {
    const result = await dispatch({ op: 'listFormats' })
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.result)).toBe(true)
  })
})

describe('origin enforcement', () => {
  it('ignores a correctly-tagged message from a disallowed origin', async () => {
    await stub.post(commandMessage('getState'), 'https://evil.example')
    // No reply at all: silence, not a refusal. A refusal would confirm the app
    // is listening and would hand back a per-origin probe.
    expect(stub.replies).toHaveLength(0)
  })

  it('ignores the opaque origin of a sandboxed frame or data: URL', async () => {
    for (const origin of ['null', '']) {
      await stub.post(commandMessage('getState'), origin)
    }
    expect(stub.replies).toHaveLength(0)
  })

  it('ignores a message whose source tag is absent or wrong', async () => {
    await stub.post({ type: 'command', command: { op: 'getState' } }, HOST_ORIGIN)
    await stub.post({ source: 'not-tela', type: 'command', command: { op: 'getState' } }, HOST_ORIGIN)
    expect(stub.replies).toHaveLength(0)
  })

  it('accepts the host origin and replies to it rather than to "*"', async () => {
    await stub.post(commandMessage('getState'), HOST_ORIGIN)
    expect(stub.replies).toHaveLength(1)
    expect(stub.replies[0].message.result.ok).toBe(true)
    expect(stub.replies[0].options.targetOrigin).toBe(HOST_ORIGIN)
    expect(stub.replies[0].options.targetOrigin).not.toBe('*')
  })

  it('accepts an origin the embedding host explicitly declared, and still not others', async () => {
    stub.uninstall()
    stub = installWindowStub(['https://studio.example'])

    await stub.post(commandMessage('getState'), 'https://studio.example')
    expect(stub.replies).toHaveLength(1)
    expect(stub.replies[0].options.targetOrigin).toBe('https://studio.example')

    await stub.post(commandMessage('getState'), 'https://evil.example')
    expect(stub.replies).toHaveLength(1)
  })

  it('does not let a declared origin reach the bridge ops either', async () => {
    stub.uninstall()
    stub = installWindowStub(['https://studio.example'])

    // Opting an origin in grants the *public* surface. It is not a back door to
    // the bridge table — a compromised or over-trusted embedder still cannot
    // swap the user's open design.
    for (const op of BRIDGE_ONLY_OPS) {
      stub.replies.length = 0
      await stub.post(commandMessage(op, { document: {} }), 'https://studio.example')
      expect(stub.replies).toHaveLength(1)
      expect(stub.replies[0].message.result.ok).toBe(false)
      expect(stub.replies[0].message.result.error).toMatch(UNKNOWN_OP)
    }
  })

  it('stops listening once the installer\'s teardown runs', async () => {
    // Answers while installed...
    await stub.post(commandMessage('getState'), HOST_ORIGIN)
    expect(stub.replies).toHaveLength(1)

    // ...and is silent afterwards. The window stub stays in place, so this
    // isolates the listener's removal rather than the stub disappearing.
    stub.removeListener()
    await stub.post(commandMessage('getState', {}, 2), HOST_ORIGIN)
    expect(stub.replies).toHaveLength(1)
  })
})
