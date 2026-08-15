/**
 * The gate, asserted against rendered output rather than against the flag.
 *
 * Every entry point enumerated on CLI-513 is driven into the state that would show
 * its AI affordance, rendered, and searched for its own marker. Asserting "the helper
 * returns false" would prove only that the helper works; six of the seven assertions
 * below check the markup a user would actually receive.
 *
 * Rendering uses `react-dom/server`, already a runtime dependency of this app. A
 * jsdom + testing-library route would have added devDependencies and mutated
 * `package-lock.json`, which ships inside the release artifact.
 *
 * **Entry point 7 is the labelled exception.** The reformat nudge becomes visible
 * from a `useEffect`, and effects do not run under static rendering — so "the nudge is
 * absent from the static markup" would be true whether or not the gate existed. Its
 * condition was extracted into `shouldOfferAiRelayout` so the assertion is made
 * against the decision the component actually takes, and can therefore fail.
 *
 * Every non-vacuous assertion here was mutation-checked: with the corresponding gate
 * removed from the component, the test fails. Results are in the wrap-up comment.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The seven entry points from the CLI-513 plan comment.
 *
 * `marker` is the string that proves the surface rendered its AI affordance;
 * `renderAsserted: false` marks the one covered indirectly, with the reason.
 */
const ENTRY_POINTS = [
  {
    id: 1,
    name: 'RightSidebar → AIPanel',
    marker: 'AI Ad Assistant',
    renderAsserted: true,
  },
  {
    id: 2,
    name: 'FloatingDock → AI dock button',
    marker: 'aria-label="AI"',
    renderAsserted: true,
  },
  {
    id: 3,
    name: "useUIStore.setRightPanel('ai') route",
    marker: null,
    renderAsserted: false,
    coveredBy: 'the route describe block below — a state assertion, not a render one',
  },
  {
    id: 4,
    name: 'AIAdBuilder overlay',
    marker: 'aria-label="More actions"',
    renderAsserted: true,
  },
  {
    id: 5,
    name: 'SettingsModal → AI Assistant tab',
    marker: 'AI Assistant',
    renderAsserted: true,
  },
  {
    id: 6,
    name: 'SettingsPage → AI Assistant tab',
    marker: 'AI Assistant',
    renderAsserted: true,
  },
  {
    id: 7,
    name: 'PreviewPanel → AI re-layout nudge',
    marker: null,
    renderAsserted: false,
    coveredBy:
      "shouldOfferAiRelayout — the component's own decision function, extracted so it is mutation-checkable; its visibility is set from a useEffect, which static rendering does not run, so a render assertion would pass vacuously",
  },
  {
    id: 8,
    name: 'InlineAIPrompt → Cmd/Ctrl+I shortcut',
    marker: null,
    renderAsserted: false,
    coveredBy:
      'isInlineAiPromptShortcut — the handler predicate, extracted so it is mutation-checkable; the listener is registered from a useEffect that static rendering does not run',
  },
] as const

it('covers every entry point enumerated for this issue', () => {
  // Seven were enumerated in the plan comment; the eighth (the Cmd/Ctrl+I shortcut in
  // InlineAIPrompt) was found by the reflect pass and is disclosed in the wrap-up.
  expect(ENTRY_POINTS).toHaveLength(8)
  // Five of the seven markers are distinct strings; 5 and 6 legitimately share one.
  const asserted = ENTRY_POINTS.filter((e) => e.renderAsserted)
  expect(asserted).toHaveLength(5)
  for (const entry of ENTRY_POINTS) {
    if (!entry.renderAsserted) expect(entry.coveredBy).toBeTruthy()
  }
})

/**
 * Load the app modules fresh under the current env stubs.
 *
 * `AI_ENABLED` (`src/lib/aiApi.ts`) and `isWorkspaceMode()` (`src/storage`) read
 * `import.meta.env` at module scope, so the graph is re-evaluated after stubbing
 * rather than imported once at the top of the file.
 */
async function loadApp(options: {
  workspaceMode: boolean
  endpoint: boolean
  /**
   * Replace the UI store with a plain snapshot-backed stand-in.
   *
   * Needed because zustand feeds React's `useSyncExternalStore` its **initial** state
   * as the server snapshot (`node_modules/zustand/esm/react.mjs`, third argument:
   * `selector(api.getInitialState())`), and that snapshot is unreachable from outside
   * — `Object.assign(useBoundStore, api)` copies the function by value, so patching
   * the exported store does not patch the `api` the hook closed over. Without this,
   * a static render always sees `rightPanel: 'inspector'`, the AI panel is never even
   * asked for, and every "the panel is absent" assertion passes vacuously.
   *
   * The stand-in is built from the real initial state, so every other selector in the
   * tree reads exactly what it would have. The real store is exercised separately by
   * the entry-point-3 block, which uses `mockUiState: undefined`.
   */
  mockUiState?: Record<string, unknown>
}) {
  vi.stubEnv('VITE_WORKSPACE_MODE', options.workspaceMode ? 'true' : '')
  vi.stubEnv('VITE_AI_API_ORIGIN', options.endpoint ? 'https://ai.example.test' : '')
  vi.resetModules()
  vi.doUnmock('@/store/useUIStore')

  if (options.mockUiState) {
    const overrides = options.mockUiState
    vi.doMock('@/store/useUIStore', async () => {
      const actual =
        await vi.importActual<typeof import('@/store/useUIStore')>('@/store/useUIStore')
      let state: Record<string, unknown> = {
        ...(actual.useUIStore.getInitialState() as unknown as Record<string, unknown>),
        ...overrides,
      }
      const store = ((selector?: (s: unknown) => unknown) =>
        selector ? selector(state) : state) as unknown as Record<string, unknown>
      store.getState = () => state
      store.getInitialState = () => state
      store.setState = (patch: Record<string, unknown>) => {
        state = { ...state, ...patch }
      }
      store.subscribe = () => () => {}
      return { ...actual, useUIStore: store }
    })
  }

  const ai = await import('@/ai')
  const { useUIStore } = await import('@/store/useUIStore')
  return {
    ai,
    useUIStore,
    RightSidebar: (await import('@/components/layout/RightSidebar')).RightSidebar,
    FloatingDock: (await import('@/components/canvas/FloatingDock')).FloatingDock,
    AIAdBuilder: (await import('@/components/canvas/AIAdBuilder')).AIAdBuilder,
    SettingsPage: (await import('@/components/library/SettingsPage')).SettingsPage,
    SettingsModal: (await import('@/components/panels/SettingsModal')).SettingsModal,
  }
}

type App = Awaited<ReturnType<typeof loadApp>>

/**
 * The UI state in which every render-asserted surface would show its AI affordance:
 * the right panel switched to AI and the settings modal open.
 *
 * Set as state rather than by calling `setRightPanel('ai')`. Going through the action
 * would make these assertions vacuous — the action refuses `'ai'` while the gate is
 * closed, so the render gate would never be exercised and the test would only be
 * re-proving the store guard that entry point 3 already covers.
 */
const AI_PANEL_OPEN = { mockUiState: { rightPanel: 'ai', settingsOpen: true } } as const

/** Render every render-asserted surface into one string. State comes from `AI_PANEL_OPEN`. */
function renderAllSurfaces(app: App): string {
  return [
    renderToStaticMarkup(React.createElement(app.RightSidebar)),
    renderToStaticMarkup(React.createElement(app.FloatingDock)),
    renderToStaticMarkup(React.createElement(app.AIAdBuilder)),
    renderToStaticMarkup(React.createElement(app.SettingsPage)),
    renderToStaticMarkup(React.createElement(app.SettingsModal)),
  ].join('\n')
}

function expectNoAiSurface(html: string) {
  for (const entry of ENTRY_POINTS) {
    if (!entry.renderAsserted) continue
    expect(
      html,
      `entry point ${entry.id} (${entry.name}) leaked into the rendered tree`,
    ).not.toContain(entry.marker)
  }
}

/**
 * The one budget this file raises, and the only thing it absorbs: a single cold Vite
 * transform of the component import graph (see `warmUpComponentGraph`).
 *
 * Measured at 0.7–0.9 s on an idle developer machine and observed at up to 7.6 s on a
 * saturated shared runner (CLI-520 PR #11, `test-macos`, run 31876427907). 30 s is
 * ~35x the local cost and ~4x the worst contended observation — far enough above both
 * that runner contention cannot reach it, while still failing in reasonable time if
 * the graph ever becomes pathological.
 *
 * No test's own budget is changed: every `it()` in this file keeps vitest's 5000 ms
 * default, and after the warm-up each one needs ~40 ms of it. This is deliberately
 * *not* a global `testTimeout` bump — the cost is one-time and belongs to one hook.
 */
const GRAPH_WARMUP_TIMEOUT_MS = 30_000

/** Timings from the warm-up, asserted on by the regression pin at the end of this file. */
const warmUp = { coldMs: 0 }

/**
 * Pay the component graph's one-time transform cost here, outside any test's budget.
 *
 * **Why this exists.** `loadApp` is cheap on every call but the first: measured over
 * three isolated runs, the first cost 705–892 ms and each identical call after it cost
 * 33–60 ms. The gap is not work the test does — it is Vite transforming the component
 * import graph, which happens once per worker. `@/components/layout/RightSidebar`
 * alone accounts for 772 ms of it cold and 33 ms once warm; `vi.resetModules()` clears
 * the module registry but never the transform cache, which is why every later
 * `loadApp` re-evaluates cheaply.
 *
 * That graph is the application's real one — RightSidebar renders ten panels, the
 * exporter and the design store — so the cost is genuine, not an accident of the test.
 * CLI-517's barrel offender was already removed in bfca518, and `@/storage` no longer
 * appears in this graph at all, so there is no remaining heavy path to cut here.
 *
 * **What went wrong without it.** Left inline, that one-time cost is billed to whichever
 * `it()` happens to run first — which is why `local mode — the default …`, and only
 * that test, kept breaching vitest's 5000 ms default: 5011 ms on windows-latest
 * (CLI-537) and 7565 ms on macOS under full-suite contention (CLI-520). Both passed on
 * a re-run with no code change. Paying the cost here leaves each test measuring only
 * its own work, so the flake's mechanism is gone rather than merely made less likely.
 *
 * The load mirrors the first test's exact configuration, and renders once too, so the
 * warm-up covers the whole path that test takes rather than only its imports. Env stubs
 * and the module registry are reset afterwards, exactly as `afterEach` does, so no test
 * observes any state from this hook.
 */
beforeAll(async () => {
  const startedAt = performance.now()
  renderAllSurfaces(await loadApp({ ...AI_PANEL_OPEN, workspaceMode: false, endpoint: false }))
  warmUp.coldMs = performance.now() - startedAt
  vi.unstubAllEnvs()
  // `vi.doMock` is *not* cleared by `vi.resetModules()` — verified, not assumed — so the
  // stand-in store this warm-up registered via `AI_PANEL_OPEN` would otherwise stay
  // registered for the tests that never call `loadApp` (the two predicate tests and the
  // capability-derivation one, which import their subject directly). `loadApp` unmocks on
  // entry, so its own callers were never affected; unmocking here makes the hook leave
  // nothing behind either way.
  vi.doUnmock('@/store/useUIStore')
  vi.resetModules()
}, GRAPH_WARMUP_TIMEOUT_MS)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('AI entry points are absent when the capability is off', () => {
  it('local mode — the default, and what the certified offline payload ships as', async () => {
    const app = await loadApp({ ...AI_PANEL_OPEN, workspaceMode: false, endpoint: false })

    expect(app.ai.getWorkspaceCapabilities().aiEnabled).toBe(false)
    expect(app.ai.isAiUiEnabled()).toBe(false)
    expectNoAiSurface(renderAllSurfaces(app))
  })

  it('local mode stays off even when a workspace record granting AI is adopted', async () => {
    const app = await loadApp({ ...AI_PANEL_OPEN, workspaceMode: false, endpoint: true })
    app.ai.adoptWorkspaceCapabilities({ aiEnabled: true })

    expect(app.ai.getWorkspaceCapabilities().aiEnabled).toBe(false)
    expect(app.ai.isAiUiEnabled()).toBe(false)
    expectNoAiSurface(renderAllSurfaces(app))
  })

  it('workspace mode with the capability off', async () => {
    const app = await loadApp({ ...AI_PANEL_OPEN, workspaceMode: true, endpoint: true })

    expect(app.ai.isAiUiEnabled()).toBe(false)
    expectNoAiSurface(renderAllSurfaces(app))
  })

  it('workspace mode with the capability on but no endpoint configured', async () => {
    const app = await loadApp({ ...AI_PANEL_OPEN, workspaceMode: true, endpoint: false })
    app.ai.adoptWorkspaceCapabilities({ aiEnabled: true })

    expect(app.ai.getWorkspaceCapabilities().aiEnabled).toBe(true)
    expect(app.ai.isAiUiEnabled()).toBe(false)
    expectNoAiSurface(renderAllSurfaces(app))
  })
})

describe('entry point 3 — the route', () => {
  let app: App

  beforeEach(async () => {
    app = await loadApp({ workspaceMode: false, endpoint: true })
  })

  it('setRightPanel refuses the ai panel while the capability is off', () => {
    app.useUIStore.setState({ rightPanel: 'inspector' })
    app.useUIStore.getState().setRightPanel('ai')
    expect(app.useUIStore.getState().rightPanel).toBe('inspector')
  })

  it('still routes to every non-ai panel', () => {
    for (const panel of ['export', 'auto-resize', 'inspector'] as const) {
      app.useUIStore.getState().setRightPanel(panel)
      expect(app.useUIStore.getState().rightPanel).toBe(panel)
    }
  })
})

describe('entry point 7 — the reformat nudge', () => {
  it('is never offered while AI is disabled, whatever else is true', async () => {
    // The nudge's own decision function, not the flag it reads. Asserting on the flag
    // alone would prove the helper works; this proves the component's condition would
    // change if the AI term were dropped — mutation-checked, unlike an assertion on
    // static markup, which the effect-driven visibility makes vacuous.
    const { shouldOfferAiRelayout } = await import('@/components/layout/PreviewPanel')

    expect(
      shouldOfferAiRelayout({ formatChanged: true, contentCount: 3, aiUiEnabled: false }),
    ).toBe(false)
    // Everything else held constant, the AI term is what decides.
    expect(
      shouldOfferAiRelayout({ formatChanged: true, contentCount: 3, aiUiEnabled: true }),
    ).toBe(true)
    // And the pre-existing conditions still hold on their own.
    expect(
      shouldOfferAiRelayout({ formatChanged: false, contentCount: 3, aiUiEnabled: true }),
    ).toBe(false)
    expect(
      shouldOfferAiRelayout({ formatChanged: true, contentCount: 0, aiUiEnabled: true }),
    ).toBe(false)
  })

  it('reads a gate that is closed on every default-path configuration', async () => {
    for (const options of [
      { workspaceMode: false, endpoint: false },
      { workspaceMode: false, endpoint: true },
      { workspaceMode: true, endpoint: false },
      { workspaceMode: true, endpoint: true },
    ]) {
      const app = await loadApp(options)
      expect(app.ai.isAiUiEnabled(), JSON.stringify(options)).toBe(false)
    }
  })
})

describe('AI entry points render when the workspace grants the capability', () => {
  it('workspace mode + aiEnabled + endpoint shows the panel, the dock item and the settings tab', async () => {
    const routing = await loadApp({ workspaceMode: true, endpoint: true })
    routing.ai.adoptWorkspaceCapabilities({ aiEnabled: true })

    expect(routing.ai.isAiUiEnabled()).toBe(true)

    // The same route action the previous block proved is refused now succeeds. Run
    // against the real store, before the mocked-store render pass.
    routing.useUIStore.setState({ rightPanel: 'inspector' })
    routing.useUIStore.getState().setRightPanel('ai')
    expect(routing.useUIStore.getState().rightPanel).toBe('ai')
    routing.ai.resetWorkspaceCapabilitiesForTests()

    const app = await loadApp({ ...AI_PANEL_OPEN, workspaceMode: true, endpoint: true })
    app.ai.adoptWorkspaceCapabilities({ aiEnabled: true })

    const html = renderAllSurfaces(app)
    for (const entry of ENTRY_POINTS) {
      if (!entry.renderAsserted) continue
      expect(html, `entry point ${entry.id} (${entry.name}) did not render`).toContain(entry.marker)
    }

    app.ai.resetWorkspaceCapabilitiesForTests()
  })
})

describe('entry point 8 — the inline AI prompt shortcut', () => {
  it('does not fire while AI is disabled, and does fire when enabled', async () => {
    const { isInlineAiPromptShortcut } = await import('@/components/canvas/InlineAIPrompt')
    const cmdI = { key: 'i', metaKey: true, ctrlKey: false }
    const ctrlI = { key: 'i', metaKey: false, ctrlKey: true }

    expect(isInlineAiPromptShortcut(cmdI, false)).toBe(false)
    expect(isInlineAiPromptShortcut(ctrlI, false)).toBe(false)
    // Everything else held constant, the AI term is what decides.
    expect(isInlineAiPromptShortcut(cmdI, true)).toBe(true)
    expect(isInlineAiPromptShortcut(ctrlI, true)).toBe(true)
    // And the original key condition still holds on its own.
    expect(isInlineAiPromptShortcut({ key: 'i', metaKey: false, ctrlKey: false }, true)).toBe(false)
    expect(isInlineAiPromptShortcut({ key: 'k', metaKey: true, ctrlKey: false }, true)).toBe(false)
  })
})

/**
 * The pin for the fix above — without it, the warm-up could be deleted, or the graph
 * could grow back over budget, and nothing would go red until CI flaked again.
 *
 * Every assertion here is measured rather than structural, because the defect was a
 * timing one; the thresholds are set far enough from the measurements that ordinary
 * runner jitter cannot trip them, and far enough from the budgets that they fail
 * *before* a real test can time out.
 */
describe('the cold graph transform stays out of the per-test budget', () => {
  it('is paid by the warm-up hook, and a warm reload is a small fraction of the budget', async () => {
    // Non-vacuity, part 1: the warm-up must have run and measured something. Deleting
    // the `beforeAll` leaves this at 0 and fails here rather than in CI three PRs later.
    expect(warmUp.coldMs).toBeGreaterThan(0)

    const startedAt = performance.now()
    await loadApp({ ...AI_PANEL_OPEN, workspaceMode: false, endpoint: false })
    const warmMs = performance.now() - startedAt

    // The property that removes the flake: once warm, a full reload of the same graph
    // is a small fraction of vitest's 5000 ms per-test default.
    //
    // The threshold is half the budget, deliberately loose. A pin that itself flakes on a
    // saturated runner would just trade one red build for another, so it is sized against
    // the worst contention on record rather than against the local measurement: the worst
    // observed cold load (7565 ms, CLI-520 run 31876427907) is ~8.9x this machine's idle
    // cold load, and applying that same factor to the warm cost (33–60 ms) predicts ~530 ms
    // at worst. 2500 ms is ~4.7x that, and still low enough that a test cannot approach the
    // 5000 ms budget from this cause without failing here first.
    expect(warmMs).toBeLessThan(2500)

    // Non-vacuity, part 2: prove the warm-up absorbed a real cost rather than being a
    // no-op that happens to pass. Measured ratio is ~20x; 3x leaves ample room. If a
    // future change makes the cold load genuinely cheap, this fails and the warm-up
    // (and its raised hook budget) should be removed — that is the intended prompt.
    expect(warmUp.coldMs).toBeGreaterThan(warmMs * 3)

    // Import-graph regression bound, in the spirit of the CLI-517 lesson: the cold load
    // measured 0.7–0.9 s here. 10 s is ~12x that — above any plausible contention, but
    // below GRAPH_WARMUP_TIMEOUT_MS, so a graph that grows heavy (a new barrel
    // dependency of the kind CLI-517 introduced) fails this test instead of quietly
    // eating the warm-up's headroom until the hook itself starts timing out.
    expect(warmUp.coldMs).toBeLessThan(10_000)
  })
})

describe('capability derivation is default-deny', () => {
  it('only the boolean true enables', async () => {
    const { capabilitiesFromWorkspace } = await import('@/ai')

    expect(capabilitiesFromWorkspace({ aiEnabled: true }).aiEnabled).toBe(true)
    for (const value of ['true', 1, {}, [], 'yes', 'false', 0, null]) {
      expect(capabilitiesFromWorkspace({ aiEnabled: value }).aiEnabled).toBe(false)
    }
    expect(capabilitiesFromWorkspace({}).aiEnabled).toBe(false)
    expect(capabilitiesFromWorkspace(null).aiEnabled).toBe(false)
    expect(capabilitiesFromWorkspace(undefined).aiEnabled).toBe(false)
  })
})
