/**
 * The agent-RPC AI gate (CLI-533), asserted by driving the real dispatch surfaces.
 *
 * CLI-513 gated eight *UI* entry points to the AI panel. The command bus is a route
 * into the same code that renders nothing, so not one of those gates sits on it: a
 * framing page can `postMessage` an op, and anything on the page (devtools, a
 * scripting agent, the MCP browser bridge) can call `window.tela.dispatch`.
 *
 * Two properties are asserted, and the second is what makes the first mean anything:
 *
 * 1. **Closed gate, nothing reaches AI.** Every op in the *real* command tables — read
 *    from `getSchema()` and `RENDER_COMMANDS`, never a list copied into this file — is
 *    dispatched on both surfaces, and the one function all AI generators funnel
 *    through (`postCanvasAI`) is asserted never to have been called. Enumerating from
 *    the live tables is the point: an op added next year is covered the day it lands,
 *    which a hand-written list would not do.
 * 2. **Open gate, AI is reached.** The same harness, the same dispatch, capability
 *    granted — and `postCanvasAI` *is* called. Without this, "the spy was not called"
 *    is equally satisfied by a harness that could never have called it, which is the
 *    CLI-513 vacuity trap (an absence assertion that holds because the thing was never
 *    requested).
 *
 * Ops erroring on missing arguments during the sweep is expected and harmless: the
 * claim under test is that AI was not *entered*, not that the ops succeeded.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** A shape layer is enough for the AI path to have something to re-compose, and unlike
 *  a text layer it needs no text measurement — this suite runs on plain Node. */
const SEED_SHAPE = { op: 'addShape', width: 100, height: 100 } as const

async function load(options: {
  workspaceMode: boolean
  endpoint: boolean
  /** Adopt a workspace record granting the capability, as a real bootstrap would. */
  grant: boolean
}) {
  vi.stubEnv('VITE_WORKSPACE_MODE', options.workspaceMode ? 'true' : '')
  vi.stubEnv('VITE_AI_API_ORIGIN', options.endpoint ? 'https://ai.example.test' : '')
  vi.resetModules()

  /**
   * The tripwire, planted at the single network chokepoint every AI generator calls
   * (`generateCopy`, `generateAdDesign`, `relayoutForFormat`). It throws rather than
   * resolving, so a call is loud and no test ever depends on a fake AI response —
   * and, being a mock, it cannot itself perform the `fetch` it stands in for.
   *
   * Spying here rather than on `relayoutActiveFrame` is deliberate: this is the last
   * point before the network, so it stays the right tripwire even if the call graph
   * above it is refactored.
   */
  const aiReached = vi.fn(async (): Promise<Response> => {
    throw new Error('postCanvasAI called — the test tripwire, never a real request')
  })
  vi.doMock('@/lib/aiApi', async () => {
    const actual = await vi.importActual<typeof import('@/lib/aiApi')>('@/lib/aiApi')
    return { ...actual, postCanvasAI: aiReached }
  })

  const ai = await import('@/ai')
  if (options.grant) ai.adoptWorkspaceCapabilities({ aiEnabled: true })

  const { dispatch, dispatchPublic, getSchema, aiGatedOps } = await import('@/agent/commands')
  const { RENDER_COMMANDS } = await import('@/agent/renderOps')

  const publicOps = (getSchema() as { commands: { op: string }[] }).commands.map((c) => c.op)
  return {
    ai,
    aiReached,
    dispatch,
    dispatchPublic,
    aiGatedOps,
    publicOps,
    bridgeOnlyOps: Object.keys(RENDER_COMMANDS),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.doUnmock('@/lib/aiApi')
})

describe('the RPC surface this issue enumerated', () => {
  it('is exactly the ops the plan comment listed — gating must not add or drop one', async () => {
    const app = await load({ workspaceMode: false, endpoint: false, grant: false })

    // Pinned as a contract: `dispatchPublic` is reachable from any allowed origin over
    // postMessage, so a silently added op is a silently widened attack surface, and a
    // silently dropped one breaks every embedder. Bridge-only ops stay bridge-only.
    expect(new Set(app.publicOps)).toEqual(
      new Set([
        'getSchema', 'getState', 'listFormats',
        'addFrame', 'removeFrame', 'duplicateFrame', 'renameFrame', 'setFrameFormat',
        'selectFrame', 'generateFormatVariants',
        'addText', 'addShape', 'updateLayer', 'removeLayer', 'duplicateLayer',
        'reorderLayer', 'setLayerConstraints', 'selectLayer',
        'relayoutFrame',
      ]),
    )
    expect(new Set(app.bridgeOnlyOps)).toEqual(new Set(['renderDocument', 'applyDocument']))
    // The bridge-only ops must never be reachable over postMessage (rpc.ts routes
    // there); AI gating is not an excuse to merge the two tables.
    for (const op of app.bridgeOnlyOps) expect(app.publicOps).not.toContain(op)
  })

  /**
   * The durability guard, and an honest statement of what the sweep below cannot do.
   *
   * The sweep dispatches every op with **no arguments**, so it detects a new
   * AI-reaching op only if that op reaches AI without them. A future
   * `generateCopy({ prompt })` would throw on the missing prompt and the sweep would
   * report "AI not reached" — true, and meaningless. Pinning the marked set closes
   * that gap from the other side: any op added to either table breaks the assertion
   * above, and any change to what is considered AI-reaching breaks this one, so a
   * human has to come here and decide. `postCanvasAI`'s check is the backstop for
   * whatever still gets through both.
   */
  it('marks exactly the ops known to reach AI — adding one forces a decision here', async () => {
    const app = await load({ workspaceMode: false, endpoint: false, grant: false })
    expect(app.aiGatedOps()).toEqual(['relayoutFrame'])
  })
})

describe('with the capability off, no op on either surface reaches AI', () => {
  /** Every configuration that is not "workspace mode + granted + endpoint". */
  const CLOSED = [
    { workspaceMode: false, endpoint: false, grant: false, name: 'local mode — what the certified offline payload ships as' },
    { workspaceMode: false, endpoint: true, grant: true, name: 'local mode, even when a record granting AI is adopted' },
    { workspaceMode: true, endpoint: true, grant: false, name: 'workspace mode, capability not granted' },
    { workspaceMode: true, endpoint: false, grant: true, name: 'workspace mode, granted, but no endpoint configured' },
  ]

  for (const config of CLOSED) {
    it(config.name, async () => {
      const app = await load(config)
      expect(app.ai.isAiEnabled()).toBe(false)

      // Seed content first, so the AI path would have something to act on and cannot
      // bail out early for the wrong reason (`relayoutActiveFrame` returns false on an
      // empty frame — an escape hatch that would mask a missing gate).
      await app.dispatch(SEED_SHAPE)

      const ops = [...app.publicOps, ...app.bridgeOnlyOps]
      expect(ops.length).toBeGreaterThan(1)
      for (const op of ops) {
        await app.dispatch({ op })
        await app.dispatchPublic({ op })
      }

      expect(
        app.aiReached,
        `an op reached AI code with the gate closed (${config.name})`,
      ).not.toHaveBeenCalled()
    })
  }

  it('relayoutFrame is refused in the DisabledAiProvider error shape, on both surfaces', async () => {
    const app = await load({ workspaceMode: false, endpoint: false, grant: false })
    const { AI_DISABLED_MESSAGE } = app.ai

    for (const send of [app.dispatch, app.dispatchPublic]) {
      const result = await send({ op: 'relayoutFrame' })
      expect(result.ok).toBe(false)
      // The same message `AiDisabledError` produces, so an agent has one vocabulary
      // for "off" rather than one per surface.
      expect(result.error).toContain(AI_DISABLED_MESSAGE)
      expect(result.error).toContain('relayoutFrame')
      // Not the "unknown command" answer: the op still exists and is still described
      // by getSchema. Gating is a refusal, not a removal.
      expect(result.error).not.toContain('Unknown command')
    }
  })

  it('refuses before the handler runs, so a gated op has no side effects', async () => {
    const app = await load({ workspaceMode: false, endpoint: false, grant: false })
    const { useWorkspaceStore } = await import('@/store/useWorkspaceStore')

    // TWO frames, deliberately. An active one and a different one to aim at — the
    // active page starts with none, so creating a single frame would leave nothing
    // for `relayoutFrame` to switch *to*, and the assertion below would be skipped
    // rather than satisfied.
    const active = (await app.dispatch({ op: 'addFrame' })).result as { frameId: string }
    const other = (await app.dispatch({ op: 'addFrame' })).result as { frameId: string }
    await app.dispatch({ op: 'selectFrame', frameId: active.frameId })

    // Preconditions, asserted rather than assumed: without these the test below can
    // pass by never exercising anything.
    expect(other.frameId).not.toBe(active.frameId)
    expect(useWorkspaceStore.getState().activeFrameId).toBe(active.frameId)
    const framesBefore = useWorkspaceStore.getState().getActivePage()?.frames.length
    expect(framesBefore).toBe(2)

    // relayoutFrame's handler switches the active frame *before* it awaits AI. A gate
    // living inside the handler would let that mutation land and only then refuse;
    // this one refuses first, so the switch never happens.
    const result = await app.dispatch({ op: 'relayoutFrame', frameId: other.frameId })

    expect(result.ok).toBe(false)
    expect(useWorkspaceStore.getState().activeFrameId).toBe(active.frameId)
    expect(useWorkspaceStore.getState().getActivePage()?.frames.length).toBe(framesBefore)
  })
})

describe('with the capability granted, the same dispatch does reach AI', () => {
  /**
   * The non-vacuity proof for every assertion above. If this test ever fails, the
   * "AI was not reached" results stop being evidence — they would then be satisfied
   * by a harness that could not reach AI under any configuration.
   */
  it('workspace mode + aiEnabled + endpoint — relayoutFrame calls the AI chokepoint', async () => {
    const app = await load({ workspaceMode: true, endpoint: true, grant: true })
    expect(app.ai.isAiEnabled()).toBe(true)

    await app.dispatch(SEED_SHAPE)
    const result = await app.dispatch({ op: 'relayoutFrame' })

    expect(app.aiReached).toHaveBeenCalledTimes(1)
    // It failed only because the tripwire threw — i.e. the request was genuinely
    // attempted, and was not refused by a gate.
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain(app.ai.AI_DISABLED_MESSAGE)

    app.ai.resetWorkspaceCapabilitiesForTests()
  })

  it('the public postMessage surface reaches it too, not just window.tela', async () => {
    const app = await load({ workspaceMode: true, endpoint: true, grant: true })

    await app.dispatch(SEED_SHAPE)
    await app.dispatchPublic({ op: 'relayoutFrame' })

    expect(app.aiReached).toHaveBeenCalledTimes(1)
    app.ai.resetWorkspaceCapabilitiesForTests()
  })
})

describe('the chokepoint gate stands on its own', () => {
  /**
   * Layer B, tested without the command bus. The dispatch gate covers the ops marked
   * `requiresAi`; this covers the ops — and the UI call sites — that nobody remembered
   * to mark. The standing r3 question is "which paths did NOT get wired into the new
   * mechanism?", and the answer has to be "none, structurally", not "none today".
   */
  it('postCanvasAI itself refuses while the capability is off, whatever the caller', async () => {
    vi.stubEnv('VITE_WORKSPACE_MODE', 'true')
    vi.stubEnv('VITE_AI_API_ORIGIN', 'https://ai.example.test')
    vi.resetModules()

    /**
     * `fetch` is replaced, not merely expected to fail. This repo ships under a
     * zero-network contract (CLI-528) and a unit test that resolves a hostname —
     * even one that does not exist — is an outbound attempt in CI. It also makes the
     * assertion sharper: reaching the stub is a positive, deterministic signal
     * instead of "some network error happened".
     */
    const reachedNetwork = vi.fn(async (): Promise<Response> => {
      throw new Error('fetch stub — the gate was passed')
    })
    vi.stubGlobal('fetch', reachedNetwork)

    const { postCanvasAI } = await import('@/lib/aiApi')
    const { AI_DISABLED_MESSAGE, adoptWorkspaceCapabilities, resetWorkspaceCapabilitiesForTests } =
      await import('@/ai')
    const request = {
      model: 'm',
      system: 's',
      messages: [{ role: 'user' as const, content: 'c' }],
      maxTokens: 1,
    }

    // Endpoint configured, so this cannot be the pre-existing "not configured" refusal.
    await expect(postCanvasAI(request)).rejects.toThrow(AI_DISABLED_MESSAGE)
    expect(reachedNetwork).not.toHaveBeenCalled()

    // With the capability granted the call gets past the gate, proving the rejection
    // above was the gate and not an unrelated failure.
    adoptWorkspaceCapabilities({ aiEnabled: true })
    await expect(postCanvasAI(request)).rejects.toThrow('fetch stub — the gate was passed')
    expect(reachedNetwork).toHaveBeenCalledTimes(1)

    resetWorkspaceCapabilitiesForTests()
    vi.unstubAllGlobals()
  })
})
