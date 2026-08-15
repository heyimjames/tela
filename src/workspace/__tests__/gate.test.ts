/**
 * The gate seam: what `WorkspaceGate` renders in each mode.
 *
 * This is the file the Lessons Log points at twice — bugs cluster at the boundary
 * between new code and the surfaces it touches, and a UI-absence assertion under
 * static rendering can be true because the UI was never requested.
 *
 * So the discipline from CLI-513 is applied literally: **the enabled case is run in
 * the same harness first**, and the login screen is watched to appear. Only then is
 * the disabled case's "children render untouched" assertion worth anything. If the
 * enabled case ever stops producing a login screen, the pair fails rather than
 * quietly agreeing that nothing is there.
 *
 * State here is visible to `renderToStaticMarkup` because this store is a plain
 * module with `useSyncExternalStore(subscribe, get, get)` — `getServerSnapshot`
 * returns live module state. That is *not* true of zustand, whose server snapshot is
 * `getInitialState`; the difference is the reason the behaviour lives in a plain
 * module rather than a store.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const CHILD_MARKER = 'local-mode-editor-marker'

async function renderGate(workspaceMode: boolean): Promise<string> {
  vi.resetModules()
  vi.doMock('@/storage', async () => {
    const actual = await vi.importActual<typeof import('@/storage')>('@/storage')
    return { ...actual, isWorkspaceMode: () => workspaceMode }
  })
  const { WorkspaceGate } = await import('../WorkspaceGate')
  return renderToStaticMarkup(
    createElement(WorkspaceGate, null, createElement('div', null, CHILD_MARKER)),
  )
}

describe('WorkspaceGate', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('@/storage')
    vi.resetModules()
  })

  it('shows the sign-in screen when workspace mode is on', async () => {
    // Run FIRST, deliberately. This is the control that makes the next test's
    // absence assertion meaningful: it proves this harness can render the gated UI
    // at all.
    const markup = await renderGate(true)

    expect(markup).toMatch(/Sign in/)
    expect(markup).toContain('workspace-password')
    expect(markup).not.toContain(CHILD_MARKER)
  })

  it('renders its children untouched when workspace mode is off', async () => {
    const markup = await renderGate(false)

    expect(markup).toContain(CHILD_MARKER)
    // No sign-in surface at all — not hidden, absent.
    expect(markup).not.toContain('workspace-password')
    expect(markup).not.toMatch(/Sign in/)
  })

  it('adds no wrapper markup around its children in local mode', async () => {
    const markup = await renderGate(false)

    // The certified payload's DOM must be what it was. The gate returns `children`,
    // so the output is exactly the child element and nothing else.
    expect(markup).toBe(`<div>${CHILD_MARKER}</div>`)
  })
})
