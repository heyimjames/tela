/**
 * The zero-network gate (CLI-528).
 *
 * The default-mode app ships inside the certified MCP payload, whose contract
 * says it makes no external network call at runtime. CLI-510 proved that once,
 * by hand. This file makes it a standing check that runs on every pull request.
 *
 * **Why runtime and not a static scan.** `src/lib/aiApi.ts` ships a real,
 * dormant `fetch` gated on `VITE_AI_API_ORIGIN`. A "no `fetch` token in the
 * bundle" scan is therefore red on `main` today and would have to be weakened
 * until it meant nothing. The honest question is not "does the string appear"
 * but "does a request happen", and only a booted browser can answer it.
 *
 * **Why two tests.** The gate asserts two counts are zero. A count is zero both
 * when nothing happened and when nothing was being watched, and those are
 * indistinguishable from a green tick. So the recorder gets its own test that
 * makes calls on purpose and demands the recorder catch them — including one
 * that must be classified *external*, so the "no external requests" assertion
 * is demonstrably capable of failing. If the instrumentation ever silently
 * breaks, that test goes red on the same PR that broke it.
 *
 * What this proves, exactly: a default-mode production build, booted in
 * headless Chromium and driven as far as an open editor, initiates no network
 * traffic. It does not prove no code path anywhere can ever reach the network —
 * the AI endpoint remains reachable in a build configured with
 * `VITE_AI_API_ORIGIN`, which is by design.
 */

import { expect, test } from '@playwright/test'

import { attachRecorder, isExternal, type Initiation, type Segment } from './recorder'
import { BASE_URL } from './origin'
import {
  exportOnce,
  expectSegmentClean,
  fireLifecycleEvents,
  importAsset,
  importViaToolbar,
  instantiateTemplate,
  layerCount,
  PNG_FILE,
  readState,
  SVG_FILE,
} from './paths'

/** A readable one-line description of an initiation, for failure messages. */
function describeInitiation(call: Initiation): string {
  const frame = call.stack.split('\n').slice(1, 4).join(' | ').trim()
  return `${call.kind} → ${call.url}\n      ${frame}`
}

test.describe('zero-network runtime gate', () => {
  test('default-mode app boots and makes no network request', async ({ page }) => {
    const recorder = await attachRecorder(page, BASE_URL)

    await page.goto('/')

    // ---- Boot assertions ------------------------------------------------
    // A blank page makes no requests either. These run *before* the network
    // assertions so a failure to boot reads as "the app did not start", never
    // as a passing offline claim.
    await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()
    expect(
      await recorder.installed(),
      'the in-page network hooks are not installed — the zero counts below would be vacuous',
    ).toBe(true)
    expect(
      await page.evaluate(() => typeof (window as unknown as { tela?: unknown }).tela),
      'window.tela (the agent RPC handle) is absent — React did not mount',
    ).toBe('object')

    // Drive it as far as a live editor: creating and opening a document is the
    // path a phone-home would most plausibly sit on, and it exercises the
    // storage adapter selected by the default build.
    await page.getByRole('button', { name: 'New file' }).click()
    await expect(page.getByRole('button', { name: 'Shapes' })).toBeVisible()
    const layoutSize = await page.evaluate(() => document.querySelector('#root')?.innerHTML.length ?? 0)
    expect(layoutSize, 'the editor rendered no markup').toBeGreaterThan(1000)

    // A service worker is the one actor that could both make requests and hide
    // them: it has its own global scope, so the init script's hooks do not
    // apply inside it. The app registers none (there is no `serviceWorker`
    // reference in `src/`), and this keeps it that way rather than trusting it.
    expect(
      await page.evaluate(async () =>
        navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
      ),
      'a service worker is registered — it could make requests this probe cannot observe',
    ).toBe(0)

    // Let anything deferred — an idle callback, a lazy chunk, a late beacon —
    // have its chance before the counts are read.
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2_000)

    // ---- The gate -------------------------------------------------------
    const external = recorder.external()
    const initiations = await recorder.initiations()

    // Logged unconditionally: a green job is not evidence a check ran, but a
    // line naming the numbers it checked is.
    console.log(
      `[zero-network] booted=true editor_opened=true total_requests=${recorder.requests.length} ` +
        `external_requests=${external.length} initiations=${initiations.length}`,
    )

    expect(
      external.map((r) => `${r.method} ${r.url} (${r.resourceType})`),
      'the default-mode app requested a resource outside its own origin',
    ).toEqual([])
    expect(
      initiations.map(describeInitiation),
      'the default-mode app initiated network traffic (fetch/XHR/WebSocket/EventSource/beacon), ' +
        'or constructed a worker this probe cannot observe into',
    ).toEqual([])

    // Same-origin traffic is expected (the app's own assets) but must be
    // non-zero: zero total requests would mean the page never loaded and the
    // two assertions above passed by observing nothing.
    expect(recorder.requests.length, 'no requests at all — the recorder saw nothing load').toBeGreaterThan(0)
  })

  test('recorder detects and classifies calls it is meant to catch', async ({ page }) => {
    const recorder = await attachRecorder(page, BASE_URL)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()

    // Deliberate calls of every kind the gate claims to observe. Failures are
    // swallowed: whether the call *succeeds* is irrelevant, only whether the
    // instrument saw the attempt.
    await page.evaluate(async () => {
      await fetch('/__probe_self_test__').catch(() => undefined)
      const xhr = new XMLHttpRequest()
      xhr.open('GET', '/__probe_self_test_xhr__')
      try {
        xhr.send()
      } catch {
        /* ignore */
      }
      try {
        // Closed immediately: the attempt is the whole point, and a live socket
        // or a retrying SSE stream would keep making requests after the test.
        new WebSocket('ws://127.0.0.1:9/__probe_self_test_ws__').close()
      } catch {
        /* ignore */
      }
      try {
        new EventSource('/__probe_self_test_sse__').close()
      } catch {
        /* ignore */
      }
      try {
        const blob = new Blob(['/* __probe_self_test_worker__ */'], { type: 'text/javascript' })
        new Worker(URL.createObjectURL(blob)).terminate()
      } catch {
        /* ignore */
      }
      // A different port is a different origin: this is the call that must come
      // back classified as external.
      await fetch('http://127.0.0.1:9/__probe_self_test_external__').catch(() => undefined)
    })

    const initiations = await recorder.initiations()
    const kinds = new Set(initiations.map((c) => c.kind))
    console.log(
      `[zero-network self-test] kinds_observed=${[...kinds].sort().join(',')} ` +
        `initiations=${initiations.length} external_classified=${recorder.external().length}`,
    )

    // Every hook the gate relies on must have fired. Listed exhaustively rather
    // than checked with `toContain`, so adding a `kind` to the recorder without
    // covering it here is a failure instead of an untested claim.
    expect([...kinds].sort()).toEqual(['eventsource', 'fetch', 'websocket', 'worker', 'xhr'])
    expect(initiations.some((c) => c.url.includes('__probe_self_test__'))).toBe(true)
    // A stack is what turns a future failure into a diagnosis.
    expect(initiations.every((c) => c.stack.length > 0)).toBe(true)

    // The browser-level observer must also have seen it, independently of the
    // in-page hooks...
    expect(recorder.requests.some((r) => r.url.includes('__probe_self_test__'))).toBe(true)
    // ...and the external classifier must be able to return a non-empty list,
    // which is what makes the gate's `toEqual([])` a falsifiable assertion.
    expect(
      recorder.external().some((r) => r.url.includes('__probe_self_test_external__')),
      'a cross-origin request was not classified as external — the gate could not detect one',
    ).toBe(true)
  })

  test('origin classifier separates same-origin from external', () => {
    // Cheap unit coverage for the one pure function the gate's verdict rests on.
    expect(isExternal(`${BASE_URL}/assets/app.js`, BASE_URL)).toBe(false)
    expect(isExternal('/assets/app.js', BASE_URL)).toBe(false)
    expect(isExternal('https://fonts.googleapis.com/css', BASE_URL)).toBe(true)
    expect(isExternal('http://127.0.0.1:9/x', BASE_URL)).toBe(true)
    expect(isExternal('data:image/png;base64,AAAA', BASE_URL)).toBe(false)
    expect(isExternal('blob:http://example.com/abc', BASE_URL)).toBe(false)
    // Protocol-relative: reads like a path, resolves to another host. The case
    // most likely to slip past a naive `startsWith(origin)` check.
    expect(isExternal('//fonts.gstatic.com/x.woff2', BASE_URL)).toBe(true)
    // Junk that is not a valid *absolute* URL is still a valid relative one, so
    // it resolves to this origin and is correctly same-origin — not a parse
    // failure. This assertion is here because the first draft of this file
    // asserted the opposite and this test caught it.
    expect(isExternal('%%not a url%%', BASE_URL)).toBe(false)
    // Genuinely unparseable, so the fail-loud branch is exercised.
    expect(isExternal('http://[::bad::]/x', BASE_URL)).toBe(true)
  })
})

/**
 * The paths CLI-528 left uncovered (CLI-536).
 *
 * The gate above proves a booted, editor-open app is silent. CLI-528's wrap-up
 * disclosed what that does *not* reach: export flows, template instantiation,
 * asset import, `pagehide`/`visibilitychange` beacons, and initiations made on
 * the way out of a document. Those are the paths a phone-home would most
 * plausibly sit on — "flush analytics when the user leaves" is the single most
 * common shape of the thing this contract forbids — and until now none of them
 * had ever been driven under the recorder.
 *
 * **What is different about the lifecycle coverage.** There is no `pagehide`,
 * `visibilitychange`, `beforeunload` or `unload` listener anywhere in `src/`,
 * and no `navigator.sendBeacon` call. So that path's zero is the purest form of
 * the trap the Lessons Log names: a count that is zero because nothing was
 * watching looks exactly like a count that is zero because nothing happened.
 * Two self-tests below answer it, and they run on every CI job rather than
 * being a mutation someone performed once:
 *
 *  - `recorder segments attribute calls to the path that made them` proves the
 *    per-path boundaries are real — that a call lands in its own segment and not
 *    a neighbour's — because a per-path zero produced by mis-drawn boundaries is
 *    worthless however honest the underlying app is.
 *  - `a beacon fired from a lifecycle handler is caught, classified and
 *    attributed` installs the exact listener the app does not have, drives both
 *    the synthetic events and a *real* reload, and demands the instrument catch
 *    the beacon in both. That is what makes this section's `toEqual([])`
 *    assertions falsifiable, and it is also the coverage for "pre-reload
 *    initiations": it proves the browser-level observer reports a request
 *    issued by a document that no longer exists.
 *
 * It also exercises `navigator.sendBeacon`, a recorder hook that shipped in
 * CLI-528 and had never been fired by any test.
 */
test.describe('zero-network runtime gate — driven paths', () => {
  test('export, template, asset-import and lifecycle paths make no network request', async ({
    page,
  }) => {
    const recorder = await attachRecorder(page, BASE_URL)
    await page.goto('/')

    // ---- Boot assertions, before any zero is read -------------------------
    await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()
    expect(
      await recorder.installed(),
      'the in-page network hooks are not installed — every zero below would be vacuous',
    ).toBe(true)

    // Each path records itself as it is checked, and the recorded list is
    // compared against the expected set at the end. A path deleted from this
    // test — or one that returns early before its check — then fails the run
    // instead of quietly shrinking the gate's coverage (the CLI-538 lesson
    // about pinning a covered set).
    const covered: string[] = []
    const clean = (segment: Segment, minRequests = 0): void => {
      expectSegmentClean(segment, minRequests)
      covered.push(segment.label)
    }

    // ---- Path: instantiate a template ------------------------------------
    const templateSegment = await recorder.begin('template-instantiate')
    await instantiateTemplate(page, /Stat Callout/)
    const template = await templateSegment.end()

    const templated = await readState(page)
    // Proof the *template* path ran, not merely that some editor opened: these
    // layer names exist only in `src/brand/templates.ts`'s Stat Callout.
    expect(templated.frames.map((f) => f.name)).toContain('Stat Callout')
    expect(templated.frames[0]?.layers.map((l) => l.name)).toEqual(
      expect.arrayContaining(['Big Number', 'Description', 'Accent Line']),
    )
    clean(template)

    // ---- Path: export a frame, in both encoders --------------------------
    // Raster and vector are separate implementations (`engine/compositor.ts`
    // canvas encode versus `engine/svgExport.ts` string build), so one is not
    // evidence about the other.
    const pngSegment = await recorder.begin('export-png')
    const pngDownload = await exportOnce(page, 'png')
    const png = await pngSegment.end()
    expect(pngDownload.suggestedFilename(), 'the PNG export produced no file').toMatch(/\.png$/)
    clean(png)

    const svgSegment = await recorder.begin('export-svg')
    const svgDownload = await exportOnce(page, 'svg')
    const svg = await svgSegment.end()
    expect(svgDownload.suggestedFilename(), 'the SVG export produced no file').toMatch(/\.svg$/)
    clean(svg)

    // ---- Path: import an asset -------------------------------------------
    // Raster and SVG take different branches inside the asset store (an image
    // decode versus a text read), and the tool bar is a different entry point
    // again, so all three are driven.
    const rasterSegment = await recorder.begin('asset-import-png')
    const afterRaster = await importAsset(page, PNG_FILE)
    const raster = await rasterSegment.end()
    expect(afterRaster, 'the PNG import added no asset').toBe(1)
    clean(raster)

    const vectorSegment = await recorder.begin('asset-import-svg')
    const afterVector = await importAsset(page, SVG_FILE)
    const vector = await vectorSegment.end()
    expect(afterVector, 'the SVG import added no asset').toBe(2)
    clean(vector)

    const layersBefore = layerCount(await readState(page))
    const toolbarSegment = await recorder.begin('asset-import-toolbar')
    await importViaToolbar(page, PNG_FILE)
    await expect
      .poll(async () => layerCount(await readState(page)), {
        message: 'the tool bar image import added no layer',
      })
      .toBe(layersBefore + 1)
    const toolbar = await toolbarSegment.end()
    clean(toolbar)

    // ---- Path: page lifecycle events -------------------------------------
    const lifecycleSegment = await recorder.begin('lifecycle-events')
    const fired = await fireLifecycleEvents(page)
    // Harvest while the document is still alive; see `Recorder.harvest`.
    await recorder.harvest()
    const lifecycle = await lifecycleSegment.end()
    expect(fired, 'the lifecycle events were not dispatched').toEqual([
      'visibilitychange',
      'pagehide',
      'beforeunload',
      'blur',
      'freeze',
    ])
    clean(lifecycle)

    // ---- Path: real teardown and reload ----------------------------------
    // The real thing, not a synthetic event: the document is destroyed and
    // rebuilt. Anything it tried to say on its way out is visible to the
    // browser-level observer, which is what covers CLI-528's "pre-reload
    // initiations".
    await recorder.harvest()
    const reloadSegment = await recorder.begin('reload-teardown')
    await page.reload()
    // Routing is in-memory, so a reload lands back on the file library rather
    // than the editor. Asserting the app came back up at all is the point here.
    await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2_000)
    const reload = await reloadSegment.end()
    expect(reload.documentReplaced, 'the reload did not replace the document').toBe(true)
    expect(
      await recorder.installed(),
      'the hooks did not reinstall after reload — the reloaded document was unwatched',
    ).toBe(true)
    // A reload must fetch the document and its bundle, so this segment is the
    // one that can carry a real non-zero floor.
    clean(reload, 3)

    // ---- Session aggregate ------------------------------------------------
    const externalTotal = recorder.external()
    const initiationsTotal = recorder.harvested()
    console.log(
      `[zero-network] paths_covered=${covered.length} [${covered.join(', ')}] ` +
        `session_requests=${recorder.requests.length} session_external=${externalTotal.length} ` +
        `session_initiations=${initiationsTotal.length}`,
    )

    // The covered set, pinned. Every path above must have reached its check —
    // a driver that threw, returned early, or was deleted changes this list.
    expect(covered, 'a covered path did not reach its network check').toEqual([
      'template-instantiate',
      'export-png',
      'export-svg',
      'asset-import-png',
      'asset-import-svg',
      'asset-import-toolbar',
      'lifecycle-events',
      'reload-teardown',
    ])
    expect(externalTotal.map((r) => `${r.method} ${r.url}`)).toEqual([])
    expect(initiationsTotal.map(describeInitiation)).toEqual([])
    expect(recorder.requests.length, 'no requests at all — the recorder saw nothing load').toBeGreaterThan(0)
  })

  test('recorder segments attribute calls to the path that made them', async ({ page }) => {
    // Without this, every per-path zero above could be produced by boundaries
    // that never contained anything.
    const recorder = await attachRecorder(page, BASE_URL)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()

    const quietBefore = await recorder.begin('selftest-quiet-before')
    const before = await quietBefore.end()

    const noisy = await recorder.begin('selftest-noisy')
    await page.evaluate(async () => {
      await fetch('/__segment_probe_same_origin__').catch(() => undefined)
      await fetch('http://127.0.0.1:9/__segment_probe_external__').catch(() => undefined)
    })
    const loud = await noisy.end()

    const quietAfter = await recorder.begin('selftest-quiet-after')
    const after = await quietAfter.end()

    console.log(
      `[zero-network self-test] segment_attribution before=${before.initiations.length} ` +
        `noisy=${loud.initiations.length} noisy_external=${loud.external.length} ` +
        `after=${after.initiations.length}`,
    )

    // The calls land in the segment that made them...
    expect(loud.initiations.map((c) => c.url)).toEqual([
      '/__segment_probe_same_origin__',
      'http://127.0.0.1:9/__segment_probe_external__',
    ])
    expect(loud.external.map((r) => r.url)).toEqual([
      'http://127.0.0.1:9/__segment_probe_external__',
    ])
    // ...and in no other segment, which is what makes a neighbouring path's
    // `[]` mean "this path was silent" rather than "the boundary was empty".
    expect(before.initiations).toEqual([])
    expect(after.initiations).toEqual([])
    expect(before.external).toEqual([])
    expect(after.external).toEqual([])
  })

  test('a beacon fired from a lifecycle handler is caught, classified and attributed', async ({
    page,
  }) => {
    const recorder = await attachRecorder(page, BASE_URL)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()

    // The listener the app deliberately does not have. Installed here so the
    // lifecycle assertions above are demonstrably capable of failing.
    await page.evaluate(() => {
      const emit = (tag: string): void => {
        try {
          navigator.sendBeacon(`/__lifecycle_beacon_${tag}__`, 'x')
        } catch {
          /* the attempt is the point, not the outcome */
        }
        try {
          navigator.sendBeacon(`http://127.0.0.1:9/__lifecycle_beacon_external_${tag}__`, 'x')
        } catch {
          /* ignore */
        }
        void fetch(`/__lifecycle_keepalive_${tag}__`, { keepalive: true }).catch(() => undefined)
      }
      window.addEventListener('pagehide', () => emit('pagehide'))
      document.addEventListener('visibilitychange', () => emit('visibilitychange'))
    })

    // ---- Synthetic events, document still alive: the in-page hooks answer ---
    const synthetic = await recorder.begin('selftest-lifecycle-synthetic')
    await fireLifecycleEvents(page)
    await recorder.harvest()
    const fromHooks = await synthetic.end()

    const kinds = [...new Set(fromHooks.initiations.map((c) => c.kind))].sort()
    console.log(
      `[zero-network self-test] lifecycle kinds=${kinds.join(',')} ` +
        `initiations=${fromHooks.initiations.length} external=${fromHooks.external.length}`,
    )
    // `sendbeacon` is the hook this whole issue is about; asserting the set
    // exhaustively means a future hook added to the recorder without coverage
    // here is a failure rather than an untested claim.
    expect(kinds).toEqual(['fetch', 'sendbeacon'])
    expect(
      fromHooks.initiations.some((c) => c.url.includes('__lifecycle_beacon_pagehide__')),
      'a beacon fired from a pagehide handler was not recorded',
    ).toBe(true)
    expect(
      fromHooks.initiations.some((c) => c.url.includes('__lifecycle_beacon_visibilitychange__')),
      'a beacon fired from a visibilitychange handler was not recorded',
    ).toBe(true)
    expect(
      fromHooks.external.length,
      'a cross-origin beacon was not classified as external — the lifecycle gate could not fail',
    ).toBeGreaterThan(0)

    // ---- Real teardown: the in-page array dies with the document ----------
    // Only the browser-level observer can answer here, and it must, or the
    // "pre-reload initiations" the gate claims to cover would be unobservable.
    const teardown = await recorder.begin('selftest-lifecycle-teardown')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Files', level: 1 })).toBeVisible()
    await page.waitForTimeout(1_000)
    const fromBrowser = await teardown.end()

    const teardownBeacons = fromBrowser.requests.filter((r) => r.url.includes('__lifecycle_'))
    console.log(
      `[zero-network self-test] teardown_requests=${fromBrowser.requests.length} ` +
        `teardown_beacons=${teardownBeacons.length} teardown_external=${fromBrowser.external.length}`,
    )
    expect(
      teardownBeacons.map((r) => r.url.replace(BASE_URL, '')).sort(),
      'a real page teardown fired beacons the browser-level observer did not report — ' +
        'the gate cannot see initiations made on the way out of a document',
    ).toEqual([
      '/__lifecycle_beacon_pagehide__',
      '/__lifecycle_beacon_visibilitychange__',
      '/__lifecycle_keepalive_pagehide__',
      '/__lifecycle_keepalive_visibilitychange__',
      'http://127.0.0.1:9/__lifecycle_beacon_external_pagehide__',
      'http://127.0.0.1:9/__lifecycle_beacon_external_visibilitychange__',
    ])
    expect(
      fromBrowser.external.length,
      'the teardown window classified nothing as external — the reload gate could not fail',
    ).toBeGreaterThan(0)
    expect(fromBrowser.documentReplaced).toBe(true)
  })
})
