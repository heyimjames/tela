/**
 * `useAIStore` — state transitions, persistence policy, and the generator seam (CLI-541).
 *
 * The other uncovered `postCanvasAI` caller disclosed by CLI-534. The module is two
 * things wearing one name: a small zustand store (model + product context + generation
 * flags) and the four functions that build prompts and call the AI chokepoint. Both are
 * tested here because both are what the file exports.
 *
 * Two harness rules this file follows, both earned:
 *
 * - **State is read through `getState()`, never through a render.** Under
 *   `renderToStaticMarkup`, `useSyncExternalStore` resolves zustand through
 *   `getInitialState`, so state set by a test is invisible and any assertion over it
 *   passes no matter what (CLI-513). Nothing here renders.
 * - **The disabled-path tests are paired with an enabled control.** "The call was
 *   refused / `fetch` was never reached" is equally satisfied by a harness that could
 *   not have reached it under any configuration, so the same call is run again with the
 *   capability granted and asserted to get through.
 *
 * `postCanvasAI` is mocked for the prompt-shape tests and left *real* for the gate
 * tests, where `fetch` is stubbed instead — that is the only way the gate itself is
 * under test rather than the mock. No test performs a real request (CLI-528).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BRAND } from '@/brand/brand.config'
import { DEFAULT_AI_MODEL } from '@/lib/aiModels'

const REQUEST_CONTEXT = {
  productName: 'Acme Widgets',
  productDescription: 'Widgets that widget.',
  targetAudience: 'Widget buyers',
  brandVoice: 'Terse',
  callToAction: 'Buy a widget',
}

const FORMAT = { width: 1080, height: 1350, label: 'Portrait' }

/** The subset of a `postCanvasAI` request the generators are responsible for building. */
interface CapturedRequest {
  model: string
  system: string
  messages: { role: string; content: string }[]
  maxTokens: number
  stream?: boolean
}

/**
 * Load the module graph with `postCanvasAI` replaced by a stub that answers with
 * `body`. Mocking at the chokepoint keeps the gate's own behaviour out of these
 * prompt-shape tests — it gets its own describe block below, where it is real.
 */
async function loadWithStubbedChokepoint(body: unknown = { text: 'generated copy' }) {
  vi.resetModules()
  const postCanvasAI = vi.fn(async (): Promise<Response> => Response.json(body))
  vi.doMock('@/lib/aiApi', async () => {
    const actual = await vi.importActual<typeof import('@/lib/aiApi')>('@/lib/aiApi')
    return { ...actual, postCanvasAI }
  })

  const store = await import('@/store/useAIStore')
  return {
    ...store,
    postCanvasAI,
    /** The single request the subject made, typed. */
    captured(): CapturedRequest {
      expect(postCanvasAI).toHaveBeenCalledTimes(1)
      return postCanvasAI.mock.calls[0]![0] as unknown as CapturedRequest
    },
  }
}

/** What zustand's `persist` writes under its key. */
interface PersistedRecord {
  state: Record<string, unknown>
  version: number
}

/**
 * Load the store with an in-memory `localStorage` in place, optionally pre-seeded with
 * a persisted record so hydration and the migration run for real.
 */
async function loadWithStorage(seed?: PersistedRecord) {
  const cells = new Map<string, string>()
  if (seed) cells.set('tela-ai', JSON.stringify(seed))
  const storage = {
    getItem: (key: string) => cells.get(key) ?? null,
    setItem: (key: string, value: string) => void cells.set(key, String(value)),
    removeItem: (key: string) => void cells.delete(key),
    clear: () => cells.clear(),
    key: (index: number) => [...cells.keys()][index] ?? null,
    get length() {
      return cells.size
    },
  }
  // On `window`, not as a bare global: zustand v5's default storage is
  // `createJSONStorage(() => window.localStorage)`, and on plain Node the missing
  // `window` is what makes `persist` turn itself into a no-op here. Stubbing the bare
  // global instead leaves the middleware inert and every assertion below vacuous —
  // verified by probe, not assumed.
  vi.stubGlobal('window', { localStorage: storage })
  vi.stubGlobal('localStorage', storage)
  vi.resetModules()

  const { useAIStore } = await import('@/store/useAIStore')
  return {
    useAIStore,
    /** The record currently in storage, parsed, or null if nothing was written. */
    stored(): PersistedRecord | null {
      const raw = cells.get('tela-ai')
      return raw === undefined ? null : (JSON.parse(raw) as PersistedRecord)
    },
    storageKeys: () => [...cells.keys()],
  }
}

afterEach(() => {
  vi.doUnmock('@/lib/aiApi')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('store defaults', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('seeds the product context from BRAND, not from a second copy of those strings', async () => {
    const { useAIStore } = await import('@/store/useAIStore')
    const state = useAIStore.getState()

    expect(state.model).toBe(DEFAULT_AI_MODEL)
    expect(state.productName).toBe(BRAND.productName)
    expect(state.productDescription).toBe(BRAND.ai.productDescription)
    expect(state.targetAudience).toBe(BRAND.ai.targetAudience)
    expect(state.brandVoice).toBe(BRAND.ai.brandVoice)
    expect(state.callToAction).toBe(BRAND.ai.callToAction)
  })

  it('starts idle with no error', async () => {
    const { useAIStore } = await import('@/store/useAIStore')

    expect(useAIStore.getState().isGenerating).toBe(false)
    expect(useAIStore.getState().lastError).toBeNull()
  })
})

describe('state transitions', () => {
  let useAIStore: typeof import('@/store/useAIStore').useAIStore

  beforeEach(async () => {
    vi.resetModules()
    useAIStore = (await import('@/store/useAIStore')).useAIStore
  })

  it('setModel replaces the model and touches nothing else', async () => {
    const before = useAIStore.getState()
    useAIStore.getState().setModel('claude-haiku-5')

    const after = useAIStore.getState()
    expect(after.model).toBe('claude-haiku-5')
    expect(after.model).not.toBe(before.model)
    // The rest of the context survives a model switch — a settings change must not
    // reset the user's product brief.
    expect(after.productName).toBe(before.productName)
    expect(after.callToAction).toBe(before.callToAction)
  })

  it('setIsGenerating moves the flag both ways', () => {
    useAIStore.getState().setIsGenerating(true)
    expect(useAIStore.getState().isGenerating).toBe(true)

    // The return leg matters more than the outbound one: a panel stuck at `true` is
    // permanently disabled.
    useAIStore.getState().setIsGenerating(false)
    expect(useAIStore.getState().isGenerating).toBe(false)
  })

  it('setLastError records a message and clears back to null', () => {
    useAIStore.getState().setLastError('Request failed (503)')
    expect(useAIStore.getState().lastError).toBe('Request failed (503)')

    useAIStore.getState().setLastError(null)
    expect(useAIStore.getState().lastError).toBeNull()
  })

  it('setProductContext merges the named fields and leaves the siblings alone', () => {
    const before = useAIStore.getState()
    useAIStore.getState().setProductContext({ productName: 'Acme', brandVoice: 'Playful' })

    const after = useAIStore.getState()
    expect(after.productName).toBe('Acme')
    expect(after.brandVoice).toBe('Playful')
    // A partial update is the whole point of the API; a `set` that replaced the slice
    // would blank these.
    expect(after.productDescription).toBe(before.productDescription)
    expect(after.targetAudience).toBe(before.targetAudience)
    expect(after.callToAction).toBe(before.callToAction)
    // And the actions must survive it — `set((s) => ({ ...s, ...updates }))` spreads
    // the whole state, so a regression here would strip the store's own methods.
    expect(typeof after.setProductContext).toBe('function')
    expect(typeof after.setModel).toBe('function')
  })

  it('accepts an empty update as a no-op', () => {
    const before = useAIStore.getState()
    useAIStore.getState().setProductContext({})

    expect(useAIStore.getState().productName).toBe(before.productName)
    expect(useAIStore.getState().brandVoice).toBe(before.brandVoice)
  })
})

/**
 * Persistence and migration, driven through a real `localStorage`.
 *
 * The store is wrapped in zustand's `persist`, and this suite runs on plain Node where
 * there is no `localStorage` — under which `persist` warns once and turns itself into a
 * no-op, taking `useAIStore.persist` with it. Reading the middleware's options object
 * would therefore be testing nothing on the path the browser takes. An in-memory
 * `Storage` is stubbed *before* the module is imported instead, so hydration, the
 * migration, and `partialize` all run for real and the assertions are over the bytes
 * that would land in the user's browser.
 */
describe('persistence policy', () => {
  it('writes the context to storage but never the transient generation state', async () => {
    const app = await loadWithStorage()

    app.useAIStore.getState().setModel('claude-haiku-5')
    app.useAIStore.getState().setIsGenerating(true)
    app.useAIStore.getState().setLastError('boom')

    const written = app.stored()
    // Non-vacuity: the store really did write, so the absences below are absences in a
    // record that exists rather than a missing record.
    expect(written).not.toBeNull()
    expect(written!.state.model).toBe('claude-haiku-5')
    // Changing the key or the version silently orphans every returning user's context
    // instead of migrating it.
    expect(app.storageKeys()).toContain('tela-ai')
    expect(written!.version).toBe(2)

    // Rehydrating a stuck spinner or a stale error from a previous session would
    // present a failure the user never triggered.
    expect(Object.keys(written!.state).sort()).toEqual([
      'brandVoice',
      'callToAction',
      'model',
      'productDescription',
      'productName',
      'targetAudience',
    ])
    expect(written!.state).not.toHaveProperty('isGenerating')
    expect(written!.state).not.toHaveProperty('lastError')
  })

  it('rehydrates a stored context over the BRAND defaults', async () => {
    const app = await loadWithStorage({
      state: { productName: 'Acme Widgets', model: 'claude-haiku-5' },
      version: 2,
    })

    expect(app.useAIStore.getState().productName).toBe('Acme Widgets')
    expect(app.useAIStore.getState().model).toBe('claude-haiku-5')
    // Fields absent from the stored slice keep their seed rather than becoming
    // undefined and rendering as "undefined" inside a prompt.
    expect(app.useAIStore.getState().brandVoice).toBe(BRAND.ai.brandVoice)
  })
})

describe('the v0 → v1 re-skin migration', () => {
  const PRE_RESKIN = {
    productName: 'Tela',
    productDescription: 'A local-first design canvas for social and ad creatives.',
  }

  it('replaces the untouched pre-re-skin defaults with the current brand', async () => {
    const app = await loadWithStorage({
      state: { ...PRE_RESKIN, model: 'claude-sonnet-5' },
      version: 0,
    })
    const state = app.useAIStore.getState()

    expect(state.productName).toBe(BRAND.productName)
    expect(state.productDescription).toBe(BRAND.ai.productDescription)
    // The retired identity must be gone, or every prompt this user ever sends keeps
    // saying "Product: Tela".
    expect(state.productName).not.toBe(PRE_RESKIN.productName)
    // Unrelated persisted fields ride through untouched.
    expect(state.model).toBe('claude-sonnet-5')
  })

  it('leaves a value the user actually typed alone', async () => {
    const app = await loadWithStorage({
      state: { productName: 'Acme Widgets', productDescription: 'Widgets that widget.' },
      version: 0,
    })

    // The whole reason the migration compares against the old defaults instead of
    // overwriting unconditionally.
    expect(app.useAIStore.getState().productName).toBe('Acme Widgets')
    expect(app.useAIStore.getState().productDescription).toBe('Widgets that widget.')
  })

  it('migrates each field independently', async () => {
    const app = await loadWithStorage({
      state: { productName: PRE_RESKIN.productName, productDescription: 'My own description.' },
      version: 0,
    })

    expect(app.useAIStore.getState().productName).toBe(BRAND.productName)
    expect(app.useAIStore.getState().productDescription).toBe('My own description.')
  })

  it('is not invoked at all for state already at the current version', async () => {
    const app = await loadWithStorage({ state: { ...PRE_RESKIN }, version: 2 })

    // Someone who deliberately typed the old strings back in after the re-skin keeps
    // them; the migration is a one-time repair, not a standing policy. Note what this
    // pins and what it does not: at a matching version `persist` never calls `migrate`,
    // so this holds no matter what the `fromVersion` guard says. The test below is the
    // one that reaches the guard.
    expect(app.useAIStore.getState().productName).toBe(PRE_RESKIN.productName)
    expect(app.useAIStore.getState().productDescription).toBe(PRE_RESKIN.productDescription)
  })

  it('leaves state written by a newer build alone — the guard, actually invoked', async () => {
    const app = await loadWithStorage({ state: { ...PRE_RESKIN }, version: 3 })

    // A downgrade (a user rolled back to this build) is the one case that hands
    // `migrate` a `fromVersion` above its own, and it is the only way to exercise the
    // `fromVersion` guard at all: with a matching version `persist` skips the
    // migration entirely, so widening that comparison is invisible to every other test
    // here. Re-branding a context on a downgrade would silently retype the user's
    // product brief.
    expect(app.useAIStore.getState().productName).toBe(PRE_RESKIN.productName)
    expect(app.useAIStore.getState().productDescription).toBe(PRE_RESKIN.productDescription)
  })
})

describe('the v1 → v2 Pyrito migration', () => {
  /**
   * The identity CLI-506 seeded. Anyone who opened the app between that re-skin
   * and this one has these exact strings in local storage, and they are seed
   * context for generated ad copy — so a missed migration does not just show a
   * stale settings field, it writes the retired brand into the user's creatives.
   */
  const HIVEMIND_ERA = {
    productName: 'HiveMind | Design',
    productDescription:
      'A local-first design canvas for social and ad creatives, built for the HiveMind division.',
  }

  it('replaces the untouched re-skin defaults with the Pyrito brand', async () => {
    const app = await loadWithStorage({
      state: { ...HIVEMIND_ERA, model: 'claude-sonnet-5' },
      version: 1,
    })
    const state = app.useAIStore.getState()

    expect(state.productName).toBe(BRAND.productName)
    expect(state.productDescription).toBe(BRAND.ai.productDescription)
    // Named rather than left to `not.toBe(BRAND.productName)`: this is the
    // string the whole rebrand exists to remove, and asserting its absence by
    // name is what makes the test fail if the migration is dropped.
    expect(state.productName).not.toContain('HiveMind')
    expect(state.productDescription).not.toContain('HiveMind')
    expect(state.model).toBe('claude-sonnet-5')
  })

  it('leaves a value the user actually typed alone', async () => {
    const app = await loadWithStorage({
      state: { productName: 'Acme Widgets', productDescription: 'Widgets that widget.' },
      version: 1,
    })

    expect(app.useAIStore.getState().productName).toBe('Acme Widgets')
    expect(app.useAIStore.getState().productDescription).toBe('Widgets that widget.')
  })

  it('carries a user returning from two rebrands ago all the way forward', async () => {
    // The reason the migration walks every retired era rather than only the last
    // one. A v0 record holds the *Tela* strings, which the v1 era's comparison
    // would not recognise; if the eras were replaced instead of accumulated,
    // this user would keep "Product: Tela" forever.
    const app = await loadWithStorage({
      state: { productName: 'Tela', productDescription: 'A local-first design canvas for social and ad creatives.' },
      version: 0,
    })

    expect(app.useAIStore.getState().productName).toBe(BRAND.productName)
  })

  it('does not touch a record that is already Pyrito', async () => {
    // The control for the assertion above: the migration must be able to leave
    // things alone, or "it rewrote the field" is indistinguishable from "it
    // rewrites every field it sees".
    const app = await loadWithStorage({
      state: { productName: BRAND.productName, productDescription: 'Hand-written brief.' },
      version: 1,
    })

    expect(app.useAIStore.getState().productName).toBe(BRAND.productName)
    expect(app.useAIStore.getState().productDescription).toBe('Hand-written brief.')
  })
})

describe('generateCopy', () => {
  it('sends the product context in the system prompt and returns the completion', async () => {
    const app = await loadWithStubbedChokepoint({ text: 'Ship it faster.' })

    const result = await app.generateCopy({
      model: 'claude-sonnet-5',
      prompt: 'Write a headline',
      productContext: REQUEST_CONTEXT,
    })

    expect(result).toBe('Ship it faster.')
    const request = app.captured()
    expect(request.model).toBe('claude-sonnet-5')
    expect(request.stream).toBe(false)
    expect(request.maxTokens).toBe(300)
    expect(request.messages).toEqual([{ role: 'user', content: 'Write a headline' }])
    // Every context field has to reach the model, or the panel's context editor is
    // decorative.
    for (const value of Object.values(REQUEST_CONTEXT)) {
      expect(request.system).toContain(value)
    }
  })

  it('returns an empty string when the endpoint answers without a text field', async () => {
    const app = await loadWithStubbedChokepoint({ usage: { tokens: 0 } })

    // `data.text ?? ''` — the caller assigns this into the canvas, and `undefined`
    // would render as the string "undefined".
    await expect(
      app.generateCopy({ model: 'm', prompt: 'p', productContext: REQUEST_CONTEXT }),
    ).resolves.toBe('')
  })

  it('propagates an endpoint failure instead of returning empty text', async () => {
    const app = await loadWithStubbedChokepoint()
    app.postCanvasAI.mockRejectedValue(new Error('Request failed (503)'))

    // A silent '' here would look like the model returned nothing, hiding the outage.
    await expect(
      app.generateCopy({ model: 'm', prompt: 'p', productContext: REQUEST_CONTEXT }),
    ).rejects.toThrow('Request failed (503)')
  })
})

describe('generateAdDesign', () => {
  it('sends the canvas size, the brand palette, and the context', async () => {
    const app = await loadWithStubbedChokepoint({ text: '[{"type":"shape"}]' })

    const result = await app.generateAdDesign({
      model: 'claude-sonnet-5',
      prompt: 'A launch ad',
      format: FORMAT,
      productContext: REQUEST_CONTEXT,
    })

    expect(result).toBe('[{"type":"shape"}]')
    const request = app.captured()
    expect(request.stream).toBe(false)
    // A layout answer is far longer than a headline; the budgets are not interchangeable.
    expect(request.maxTokens).toBe(2000)
    expect(request.messages).toEqual([{ role: 'user', content: 'A launch ad' }])
    expect(request.system).toContain('1080x1350')
    expect(request.system).toContain('Portrait')
    expect(request.system).toContain(REQUEST_CONTEXT.productName)

    const { AI_BRAND_COLOR_LIST } = await import('@/brand/palette')
    // The palette is enumerated into the prompt so the model cannot invent off-brand
    // colours; a prompt without it is how off-palette designs get generated.
    expect(request.system).toContain(AI_BRAND_COLOR_LIST)
  })
})

describe('relayoutForFormat', () => {
  it('sends the existing layers and the new canvas, and asks for JSON only', async () => {
    const app = await loadWithStubbedChokepoint({ text: '[]' })
    const layers = [{ type: 'text', content: 'Existing headline', colorToken: 'charcoal' }]

    await app.relayoutForFormat({ model: 'm', layers, format: FORMAT })

    const request = app.captured()
    expect(request.maxTokens).toBe(2000)
    expect(request.stream).toBe(false)
    // The content must travel with the request — a re-layout that loses the copy is a
    // regeneration, which is the one thing this function promises not to do.
    expect(request.system).toContain('Existing headline')
    expect(request.system).toContain('1080x1350')
    expect(request.messages).toEqual([
      { role: 'user', content: 'Re-layout the design for the new canvas.' },
    ])
  })
})

describe('relayoutActiveFrame', () => {
  it('returns false without reaching AI when the frame has no content', async () => {
    const app = await loadWithStubbedChokepoint()

    await expect(app.relayoutActiveFrame()).resolves.toBe(false)
    // An empty canvas is not an error and not a request; spending a call on it would
    // return a layout for content that does not exist.
    expect(app.postCanvasAI).not.toHaveBeenCalled()
  })

  it('sends the frame content and applies the answer when there is content', async () => {
    const app = await loadWithStubbedChokepoint({
      text: JSON.stringify([
        {
          type: 'shape',
          name: 'bg',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          shape: 'rectangle',
          colorToken: 'brand-dark',
          borderRadius: 0,
        },
      ]),
    })
    const { useDesignStore } = await import('@/store/useDesignStore')
    useDesignStore.getState().addLayer({
      type: 'shape',
      name: 'seed',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      shape: 'rectangle',
      fill: { token: 'brand-dark' },
      borderRadius: 0,
    })

    // Precondition, asserted rather than assumed: with no layer the test below would
    // pass through the early return and prove nothing (CLI-533).
    expect(useDesignStore.getState().document.layers.length).toBeGreaterThan(0)

    await expect(app.relayoutActiveFrame()).resolves.toBe(true)
    expect(app.postCanvasAI).toHaveBeenCalledTimes(1)
    // The model choice comes from the store, not from a hard-coded default.
    expect(app.captured().model).toBe(app.useAIStore.getState().model)
    // The seeded layer travelled with the request — this is a re-layout of what is on
    // the canvas, not a fresh generation.
    expect(app.captured().system).toContain('"type": "shape"')
  })

  it('returns false when the model answers with unusable JSON', async () => {
    const app = await loadWithStubbedChokepoint({ text: 'sorry, I cannot do that' })
    const { useDesignStore } = await import('@/store/useDesignStore')
    useDesignStore.getState().addLayer({
      type: 'shape',
      name: 'seed',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      shape: 'rectangle',
      fill: { token: 'brand-dark' },
      borderRadius: 0,
    })
    expect(useDesignStore.getState().document.layers.length).toBeGreaterThan(0)

    // It was genuinely attempted — this is a parse refusal, not the empty-frame path.
    await expect(app.relayoutActiveFrame()).resolves.toBe(false)
    expect(app.postCanvasAI).toHaveBeenCalledTimes(1)
  })
})

describe('the disabled path, with the real gate in place', () => {
  /**
   * `postCanvasAI` is NOT mocked here. `fetch` is stubbed instead, so reaching the
   * network is a positive, deterministic signal and the gate itself is the subject.
   */
  async function loadWithRealGate(options: { workspaceMode: boolean; endpoint: boolean }) {
    vi.stubEnv('VITE_WORKSPACE_MODE', options.workspaceMode ? 'true' : '')
    vi.stubEnv('VITE_AI_API_ORIGIN', options.endpoint ? 'https://ai.example.test' : '')
    vi.resetModules()

    const reachedNetwork = vi.fn(async (): Promise<Response> => Response.json({ text: 'served' }))
    vi.stubGlobal('fetch', reachedNetwork)

    const store = await import('@/store/useAIStore')
    const ai = await import('@/ai')
    return { ...store, ai, reachedNetwork }
  }

  const CALL = { model: 'm', prompt: 'p', productContext: REQUEST_CONTEXT }

  it('refuses generateCopy in the DisabledAiProvider vocabulary and never reaches fetch', async () => {
    const app = await loadWithRealGate({ workspaceMode: true, endpoint: true })
    expect(app.ai.isAiEnabled()).toBe(false)

    // Endpoint configured, so this cannot be the "not configured" refusal — it is the
    // capability half.
    await expect(app.generateCopy(CALL)).rejects.toThrow(app.ai.AI_DISABLED_MESSAGE)
    expect(app.reachedNetwork).not.toHaveBeenCalled()

    app.ai.resetWorkspaceCapabilitiesForTests()
  })

  it('refuses every generator, not only the one the panel happens to call', async () => {
    const app = await loadWithRealGate({ workspaceMode: true, endpoint: true })

    await expect(
      app.generateAdDesign({ ...CALL, format: FORMAT }),
    ).rejects.toThrow(app.ai.AI_DISABLED_MESSAGE)
    await expect(
      app.relayoutForFormat({ model: 'm', layers: [{ type: 'text' }], format: FORMAT }),
    ).rejects.toThrow(app.ai.AI_DISABLED_MESSAGE)
    expect(app.reachedNetwork).not.toHaveBeenCalled()

    app.ai.resetWorkspaceCapabilitiesForTests()
  })

  it('reports the missing endpoint differently from the missing capability', async () => {
    const app = await loadWithRealGate({ workspaceMode: true, endpoint: false })
    app.ai.adoptWorkspaceCapabilities({ aiEnabled: true })

    // A build with no endpoint is a deployment mistake and must say so, rather than
    // telling the operator their workspace lacks a capability it in fact holds.
    const error = await app.generateCopy(CALL).then(
      () => null,
      (err: Error) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain('VITE_AI_API_ORIGIN')
    expect(error!.message).not.toContain(app.ai.AI_DISABLED_MESSAGE)
    expect(app.reachedNetwork).not.toHaveBeenCalled()

    app.ai.resetWorkspaceCapabilitiesForTests()
  })

  it('is unconditionally refused in local mode, capability record or not', async () => {
    const app = await loadWithRealGate({ workspaceMode: false, endpoint: true })
    app.ai.adoptWorkspaceCapabilities({ aiEnabled: true })

    // The certified offline payload ships as a local build; adopting a record there
    // must not turn AI on.
    await expect(app.generateCopy(CALL)).rejects.toThrow(app.ai.AI_DISABLED_MESSAGE)
    expect(app.reachedNetwork).not.toHaveBeenCalled()

    app.ai.resetWorkspaceCapabilitiesForTests()
  })

  it('relayoutActiveFrame surfaces the refusal rather than reporting a quiet false', async () => {
    const app = await loadWithRealGate({ workspaceMode: true, endpoint: true })
    const { useDesignStore } = await import('@/store/useDesignStore')
    useDesignStore.getState().addLayer({
      type: 'shape',
      name: 'seed',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      shape: 'rectangle',
      fill: { token: 'brand-dark' },
      borderRadius: 0,
    })
    // Without content it would return false at the early exit and never reach the gate.
    expect(useDesignStore.getState().document.layers.length).toBeGreaterThan(0)

    await expect(app.relayoutActiveFrame()).rejects.toThrow(app.ai.AI_DISABLED_MESSAGE)
    expect(app.reachedNetwork).not.toHaveBeenCalled()

    app.ai.resetWorkspaceCapabilitiesForTests()
  })

  /**
   * The non-vacuity half. Without this, every "rejected / fetch not reached" assertion
   * above is equally satisfied by a harness that could never have reached fetch at all
   * — the CLI-513 trap. Same module graph, same call, capability granted.
   */
  it('with the capability granted, the same call gets through to fetch', async () => {
    const app = await loadWithRealGate({ workspaceMode: true, endpoint: true })
    app.ai.adoptWorkspaceCapabilities({ aiEnabled: true })
    expect(app.ai.isAiEnabled()).toBe(true)

    await expect(app.generateCopy(CALL)).resolves.toBe('served')
    expect(app.reachedNetwork).toHaveBeenCalledTimes(1)
    const [url, init] = app.reachedNetwork.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai.example.test/api/tela-ai')
    // Same-origin proxies authenticate by session cookie; dropping this silently logs
    // every workspace out of its own AI endpoint.
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')

    app.ai.resetWorkspaceCapabilitiesForTests()
  })
})
