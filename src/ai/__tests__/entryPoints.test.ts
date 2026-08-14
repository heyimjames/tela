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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
