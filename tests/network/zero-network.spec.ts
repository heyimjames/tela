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

import { attachRecorder, isExternal, type Initiation } from './recorder'
import { BASE_URL } from './origin'

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
      'the default-mode app initiated a fetch/XHR/WebSocket/EventSource/beacon',
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

    // Every hook the gate relies on must have fired.
    expect([...kinds].sort()).toEqual(['eventsource', 'fetch', 'websocket', 'xhr'])
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
