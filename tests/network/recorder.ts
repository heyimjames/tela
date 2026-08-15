/**
 * The instrument the zero-network gate reads.
 *
 * Two independent observers, because either one alone has a blind spot:
 *
 *  1. **In-page initiation hooks** (`fetch`, `XMLHttpRequest`, `WebSocket`,
 *     `EventSource`, `navigator.sendBeacon`). These catch an *attempt* even
 *     when no request ever reaches the wire — a `fetch` to an unreachable host
 *     that fails in DNS still proves the app tried to talk to the network, and
 *     that is the property under test. They also capture a stack, so a failure
 *     names the culprit instead of just asserting a number.
 *  2. **CDP-level request events** (`page.on('request')`). These catch loads the
 *     in-page hooks structurally cannot see: `<img src>`, `<link>`, `@font-face`,
 *     a lazily-imported chunk, a beacon issued from a worker.
 *
 * The hooks call through to the natives rather than swallowing the call. A
 * recorder that silently dropped requests would change the app's behaviour
 * under measurement, and a probe that alters its subject is not evidence.
 */

import type { Page, Request } from '@playwright/test'

/**
 * A network initiation observed from inside the page.
 *
 * `worker` is here for a different reason than the rest. A Worker is not itself
 * a network call — it is a context this recorder cannot see into, because an
 * init script patches the page's globals and a worker has its own. The app
 * constructs none today, so rather than leave a future one as a silent hole in
 * the gate, constructing one is treated as an initiation: adding a worker turns
 * the gate red and forces whoever added it to extend the probe.
 */
export interface Initiation {
  kind: 'fetch' | 'xhr' | 'websocket' | 'eventsource' | 'sendbeacon' | 'worker'
  url: string
  stack: string
}

/** A request observed at the browser level, classified against the app origin. */
export interface ObservedRequest {
  url: string
  method: string
  resourceType: string
  external: boolean
}

interface ProbeWindow extends Window {
  __telaNetProbe?: { installed: true; doc: string; calls: Initiation[] }
}

/**
 * Installed with `addInitScript`, so it is in place before the first byte of
 * app code runs in every frame — including frames created later. Patching from
 * a `page.evaluate` after navigation would miss everything the app does on
 * boot, which is exactly where a phone-home would live.
 */
function instrument(): void {
  const w = window as ProbeWindow
  if (w.__telaNetProbe) return
  const calls: Initiation[] = []
  // A token identifying *this* document. The init script runs again in every
  // new document, so a fresh token is how the test side detects that the array
  // it was slicing has been replaced by a navigation rather than truncated.
  w.__telaNetProbe = {
    installed: true,
    doc: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    calls,
  }

  const record = (kind: Initiation['kind'], url: unknown): void => {
    calls.push({ kind, url: String(url), stack: new Error().stack ?? '<no stack>' })
  }

  const nativeFetch = window.fetch
  window.fetch = function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    record('fetch', url)
    return nativeFetch.call(this ?? window, input, init)
  } as typeof window.fetch

  const nativeOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    ...args: Parameters<typeof nativeOpen>
  ) {
    record('xhr', args[1])
    return nativeOpen.apply(this, args)
  } as typeof nativeOpen

  const wrapConstructor = <T extends abstract new (...args: never[]) => unknown>(
    Target: T,
    kind: Initiation['kind'],
  ): T =>
    new Proxy(Target, {
      construct(target, args, newTarget) {
        record(kind, args[0])
        return Reflect.construct(target as never, args, newTarget)
      },
    })

  window.WebSocket = wrapConstructor(window.WebSocket, 'websocket')
  if (typeof window.EventSource === 'function') {
    window.EventSource = wrapConstructor(window.EventSource, 'eventsource')
  }
  // Not network calls — blind spots. See the `worker` note on `Initiation`.
  if (typeof window.Worker === 'function') {
    window.Worker = wrapConstructor(window.Worker, 'worker')
  }
  if (typeof window.SharedWorker === 'function') {
    window.SharedWorker = wrapConstructor(window.SharedWorker, 'worker')
  }
  if (typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null): boolean => {
      record('sendbeacon', url)
      return nativeBeacon(url, data)
    }
  }
}

/**
 * A request counts as external when it leaves the app's own origin.
 *
 * Non-HTTP schemes (`data:`, `blob:`, `about:`) never touch the network and are
 * not external. An unparseable URL is treated as external rather than ignored:
 * the failure mode of this gate must be a false alarm someone investigates, not
 * a silent pass.
 */
export function isExternal(url: string, origin: string): boolean {
  if (/^(data|blob|about|javascript|filesystem):/i.test(url)) return false
  try {
    const parsed = new URL(url, origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return parsed.origin !== new URL(origin).origin
  } catch {
    return true
  }
}

/**
 * What one driven UI path did to the network (CLI-536).
 *
 * The gate's headline number is an aggregate zero over a whole session, which
 * cannot say *which* path was covered. A segment is that zero, per path, so the
 * probe log names each covered path and its own counts — and so a future
 * regression points at the path that caused it instead of at the session.
 */
export interface Segment {
  label: string
  /** Browser-level requests observed while the segment was open. */
  requests: ObservedRequest[]
  /** Of those, the ones that left the app origin. */
  external: ObservedRequest[]
  /** In-page initiations harvested while the segment was open. */
  initiations: Initiation[]
  /** True if the document was replaced (navigation/reload) inside the segment. */
  documentReplaced: boolean
}

/** An open segment. Call `end()` once; calling it twice is a test-authoring bug. */
export interface OpenSegment {
  end(): Promise<Segment>
}

export interface Recorder {
  /** Every request the browser made, in order. */
  requests: ObservedRequest[]
  /** Requests that left the app origin. Must be empty on the default path. */
  external(): ObservedRequest[]
  /** Every fetch/XHR/WS/EventSource/beacon initiated from inside the page. */
  initiations(): Promise<Initiation[]>
  /** Whether the in-page hooks are actually installed in the live document. */
  installed(): Promise<boolean>
  /**
   * Copy any not-yet-copied in-page initiations into the test-side accumulator.
   *
   * The in-page array dies with its document, so anything a page does on its way
   * out — a `pagehide` beacon, the "pre-reload initiations" CLI-528 left
   * uncovered — is only reportable from the in-page hooks if it is harvested
   * *before* the document is torn down. Call this before triggering any
   * navigation. (The browser-level observer is unaffected: it lives test-side
   * and sees the teardown window regardless. That is the point of having two.)
   */
  harvest(): Promise<Initiation[]>
  /** Everything harvested so far, across every document this page has held. */
  harvested(): Initiation[]
  /** Open a named segment covering one driven UI path. */
  begin(label: string): Promise<OpenSegment>
}

/** Attach both observers to a page. Call before the first `goto`. */
export async function attachRecorder(page: Page, origin: string): Promise<Recorder> {
  const requests: ObservedRequest[] = []

  await page.addInitScript(instrument)

  page.on('request', (request: Request) => {
    const url = request.url()
    requests.push({
      url,
      method: request.method(),
      resourceType: request.resourceType(),
      external: isExternal(url, origin),
    })
  })

  // Test-side accumulator. Survives the documents it is harvested from, which is
  // what lets a segment span a reload.
  const harvestedCalls: Initiation[] = []
  let cursor: { doc: string; consumed: number } | null = null
  let documentsSeen = 0

  const harvest = async (): Promise<Initiation[]> => {
    const snapshot = await page.evaluate(() => {
      const probe = (window as ProbeWindow).__telaNetProbe
      return probe ? { doc: probe.doc, calls: probe.calls.slice() } : null
    })
    if (!snapshot) return []
    const fresh =
      cursor && cursor.doc === snapshot.doc ? snapshot.calls.slice(cursor.consumed) : snapshot.calls
    if (!cursor || cursor.doc !== snapshot.doc) documentsSeen += 1
    cursor = { doc: snapshot.doc, consumed: snapshot.calls.length }
    harvestedCalls.push(...fresh)
    return fresh
  }

  return {
    requests,
    external: () => requests.filter((r) => r.external),
    initiations: async () =>
      page.evaluate(() => (window as ProbeWindow).__telaNetProbe?.calls ?? []),
    installed: async () =>
      page.evaluate(() => (window as ProbeWindow).__telaNetProbe?.installed === true),
    harvest,
    harvested: () => harvestedCalls.slice(),

    async begin(label: string): Promise<OpenSegment> {
      // A segment over a document whose hooks are missing would report an
      // initiation count of zero and pass — the exact "zero because nothing was
      // watching" failure this probe exists to rule out. `harvest` cannot raise
      // it (an absent probe and a quiet one both yield no calls), so the
      // condition is checked here, once per path, before the path is driven.
      const watching = await page.evaluate(
        () => (window as ProbeWindow).__telaNetProbe?.installed === true,
      )
      if (!watching) {
        throw new Error(
          `segment "${label}": the in-page network hooks are not installed in the current ` +
            'document, so this path\'s initiation count would be vacuously zero',
        )
      }

      // Draw the boundary by draining everything outstanding into the previous
      // segment's territory first, so a call made before this path started
      // cannot be attributed to it (nor this path's calls to the last one).
      await harvest()
      const requestsAt = requests.length
      const harvestedAt = harvestedCalls.length
      const documentsAt = documentsSeen
      let ended = false

      return {
        async end(): Promise<Segment> {
          if (ended) throw new Error(`segment "${label}" ended twice`)
          ended = true
          await harvest()
          const segmentRequests = requests.slice(requestsAt)
          return {
            label,
            requests: segmentRequests,
            external: segmentRequests.filter((r) => r.external),
            initiations: harvestedCalls.slice(harvestedAt),
            documentReplaced: documentsSeen > documentsAt,
          }
        },
      }
    },
  }
}
