/**
 * Driving the covered UI paths, and reading a segment's verdict (CLI-536).
 *
 * CLI-528's gate drove the app as far as an open editor. The paths it disclosed
 * as uncovered — export, template instantiation, asset import, `pagehide` /
 * `visibilitychange` beacons, pre-reload initiations — live here as named
 * drivers, so the spec reads as a list of paths rather than a wall of
 * selectors, and so the *evidence* each driver produces (the download that
 * fired, the asset tile that appeared) sits next to the clicks that produced it.
 *
 * Two rules every driver here follows:
 *
 *  1. **It returns proof the path actually ran.** A path that silently no-ops
 *     produces a perfectly clean segment, and a clean segment from a path that
 *     never executed is exactly the false record the Lessons Log warns about.
 *     Each driver returns a positive outcome of its own — a `download` event, an
 *     asset-tile count, the fired event names — which the spec asserts *before*
 *     it reads any zero.
 *  2. **It leaves the app usable by the next driver.** These run in sequence
 *     against one page, because a phone-home on the fifth action of a session is
 *     as much a violation as one on boot, and a fresh page per path would never
 *     reach that state.
 *
 * None of these drivers touch the network themselves. Every fixture is bytes
 * built in-process; nothing is fetched, and no dependency was added to get them.
 */

import { expect, type Download, type Locator, type Page } from '@playwright/test'

import type { Initiation, Segment } from './recorder'

/**
 * A 1×1 PNG. Small on purpose: the asset store waits on `new Image()` decoding
 * before it commits a raster asset, so the bytes must be a real image, but
 * nothing about this path cares how big it is.
 */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * An SVG with no external references. Deliberately self-contained: a fixture
 * that referenced a remote font or image would produce a request attributable
 * to the *test*, and the gate would then be measuring its own fixture.
 */
export const SVG_FIXTURE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">' +
    '<rect width="8" height="8" fill="#0af"/></svg>',
  'utf8',
)

export const PNG_FILE = { name: 'probe-dot.png', mimeType: 'image/png', buffer: PNG_1X1 }
export const SVG_FILE = { name: 'probe-mark.svg', mimeType: 'image/svg+xml', buffer: SVG_FIXTURE }

/** Asset tiles carry a `Delete <name>` button each; counting them counts assets. */
function assetTiles(page: Page): Locator {
  return page.getByRole('button', { name: /^Delete / })
}

/**
 * The panel column holding the export controls — not the tool bar's toggle.
 *
 * Identified by its format row rather than by its "Export" button, because that
 * button is relabelled ("Exporting…", then "Done") while an export is running.
 * A locator keyed on the label would stop matching the panel at exactly the
 * moment the next assertion needs it, which is how the first draft of this
 * helper closed the panel it was trying to find.
 */
function exportPanel(page: Page): Locator {
  return page.locator('aside').filter({ has: page.getByRole('button', { name: /^png$/i }) })
}

/**
 * A structural snapshot of the editor, read through the app's own agent RPC.
 *
 * Used for the "did this path actually do something" assertions. Always read
 * *outside* a segment: it is a call into app code, and a probe that measures
 * its own instrumentation is measuring the wrong thing.
 */
export async function readState(page: Page): Promise<{
  frames: Array<{ name: string; layers: Array<{ name: string; type: string }> }>
}> {
  return page.evaluate(async () => {
    const tela = (window as unknown as {
      tela?: { dispatch: (c: unknown) => Promise<{ ok: boolean; result?: unknown }> }
    }).tela
    if (!tela) throw new Error('window.tela is absent — the app did not mount')
    const response = await tela.dispatch({ op: 'getState' })
    if (!response.ok) throw new Error('getState failed')
    return response.result as {
      frames: Array<{ name: string; layers: Array<{ name: string; type: string }> }>
    }
  })
}

/** Total layers across every frame. The cheapest proof an import added something. */
export function layerCount(state: Awaited<ReturnType<typeof readState>>): number {
  return state.frames.reduce((total, frame) => total + frame.layers.length, 0)
}

/**
 * Files screen → a template's document open in the editor.
 *
 * Only the editor-is-up check happens here. Which document arrived is asserted
 * by the caller from `readState`, outside the measured segment: any "New file"
 * would open an editor, so "the editor opened" alone does not distinguish the
 * template path from the path CLI-528 already covered.
 */
export async function instantiateTemplate(page: Page, templateName: RegExp): Promise<void> {
  await page.locator('aside').getByRole('button', { name: 'Templates' }).first().click()
  await expect(page.getByRole('heading', { name: 'Start from a template' })).toBeVisible()
  await page.getByRole('button', { name: templateName }).first().click()
  await expect(page.getByRole('button', { name: 'Shapes' })).toBeVisible()
}

/**
 * Export the open document in one format, through the real export panel.
 *
 * Returns the `download` event. Every export in this app is an `<a download>`
 * over a `blob:` URL (`engine/compositor.ts`, `engine/svgExport.ts`), so a
 * download firing is the end-to-end evidence that the render, the encode and
 * the hand-off all completed. The panel's own "Done" label is set by the same
 * code path and would appear even if the blob were empty, so it is not the
 * evidence — it is only waited on, to keep the next segment's boundary clean of
 * this path's trailing work.
 */
export async function exportOnce(page: Page, format: 'png' | 'svg'): Promise<Download> {
  if ((await exportPanel(page).count()) === 0) {
    await page.locator('header').getByRole('button', { name: 'Export' }).click()
  }
  const panel = exportPanel(page)
  await expect(panel, 'the export panel did not open').toHaveCount(1)
  await panel.getByRole('button', { name: new RegExp(`^${format}$`, 'i') }).click()

  const downloadPromise = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  // Wait for the button to come back out of its "Exporting…"/"Done" states, so
  // the panel is settled before the next segment's boundary is drawn and the
  // next caller finds the control it expects.
  await expect(panel.getByRole('button', { name: 'Export', exact: true })).toBeVisible({
    timeout: 15_000,
  })
  return download
}

/**
 * Import a file through the asset library's real `<input type=file>`.
 *
 * Returns the asset-tile count afterwards. The store reads the file with
 * `FileReader` and, for raster, waits on an image decode before committing — so
 * the tile appearing is proof the import completed, where `setInputFiles`
 * returning proves only that a DOM event was delivered.
 */
export async function importAsset(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<number> {
  await page.getByRole('button', { name: 'Assets' }).first().click()
  const input = page.locator('aside input[type="file"][accept="image/*,.svg"]')
  await expect(input, 'the asset library file input is not in the DOM').toHaveCount(1)
  const before = await assetTiles(page).count()
  await input.setInputFiles(file)
  await expect(assetTiles(page)).toHaveCount(before + 1)
  return before + 1
}

/**
 * The tool bar's Image button — a *second*, structurally different import.
 *
 * It builds a detached `<input type=file>` and clicks it, so there is no element
 * in the document to set files on and the file chooser is the only way in. It is
 * covered because "asset import" is one capability with two implementations, and
 * a gate wired to one of them says nothing about the other (the Lessons Log's
 * "which existing paths did NOT get wired in" question).
 *
 * Awaiting the chooser is itself the proof the right control was hit: no other
 * button on the screen opens one.
 */
export async function importViaToolbar(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Image', exact: true }).first().click()
  const chooser = await chooserPromise
  await chooser.setFiles(file)
}

/**
 * The lifecycle events a beacon would ride out on, fired without unloading.
 *
 * Synthetic dispatch is not byte-for-byte the event a real navigation produces,
 * but it reaches every `addEventListener` handler, and it happens while the
 * document is still alive — which is the only window in which the in-page hooks
 * can still be harvested. Real teardown is covered separately in the same test,
 * by the browser-level observer, which outlives the document.
 *
 * Returns the event names fired, so a caller can assert the drive happened
 * rather than assume it.
 */
export async function fireLifecycleEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fired: string[] = []
    const dispatch = (target: EventTarget, event: Event): void => {
      target.dispatchEvent(event)
      fired.push(event.type)
    }
    dispatch(document, new Event('visibilitychange'))
    dispatch(window, new PageTransitionEvent('pagehide', { persisted: false }))
    dispatch(window, new Event('beforeunload', { cancelable: true }))
    dispatch(window, new Event('blur'))
    dispatch(document, new Event('freeze'))
    return fired
  })
}

/**
 * A readable one-line description of an initiation, for failure messages.
 *
 * Not exported: the spec has its own copy of this from CLI-528, and two
 * differently-named formatters in one failure message would be worse than the
 * duplication. This one exists so `expectSegmentClean` does not have to import
 * from a spec file.
 */
function describeInitiation(call: Initiation): string {
  const frame = call.stack.split('\n').slice(1, 4).join(' | ').trim()
  return `${call.kind} → ${call.url}\n      ${frame}`
}

/**
 * Log a segment's counts, then assert its two zeros.
 *
 * The log line is unconditional and names the path, because the acceptance
 * criterion is that each covered path *appears in the probe log*: a green job is
 * not evidence a path ran, but a line naming the path and the numbers it
 * checked is.
 *
 * `minRequests` is the anti-vacuity guard and it is per path on purpose. Most of
 * these paths legitimately make no same-origin request either — the bundle is
 * already loaded and the work is all local — so requiring traffic everywhere
 * would be a false assertion. Where a path *must* produce traffic (a reload),
 * the caller says so; everywhere else the driver's returned evidence carries the
 * "it ran" claim instead, asserted before this function is called.
 */
export function expectSegmentClean(segment: Segment, minRequests = 0): void {
  console.log(
    `[zero-network] path=${segment.label} requests=${segment.requests.length} ` +
      `external=${segment.external.length} initiations=${segment.initiations.length} ` +
      `document_replaced=${segment.documentReplaced}`,
  )
  expect(
    segment.external.map((r) => `${r.method} ${r.url} (${r.resourceType})`),
    `path "${segment.label}" requested a resource outside the app's own origin`,
  ).toEqual([])
  expect(
    segment.initiations.map(describeInitiation),
    `path "${segment.label}" initiated network traffic ` +
      '(fetch/XHR/WebSocket/EventSource/beacon), or constructed a worker this probe cannot see into',
  ).toEqual([])
  expect(
    segment.requests.length,
    `path "${segment.label}" saw fewer requests than it must — the recorder was not observing it`,
  ).toBeGreaterThanOrEqual(minRequests)
}
