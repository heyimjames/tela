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
  __telaNetProbe?: { installed: true; calls: Initiation[] }
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
  w.__telaNetProbe = { installed: true, calls }

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

export interface Recorder {
  /** Every request the browser made, in order. */
  requests: ObservedRequest[]
  /** Requests that left the app origin. Must be empty on the default path. */
  external(): ObservedRequest[]
  /** Every fetch/XHR/WS/EventSource/beacon initiated from inside the page. */
  initiations(): Promise<Initiation[]>
  /** Whether the in-page hooks are actually installed in the live document. */
  installed(): Promise<boolean>
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

  return {
    requests,
    external: () => requests.filter((r) => r.external),
    initiations: async () =>
      page.evaluate(() => (window as ProbeWindow).__telaNetProbe?.calls ?? []),
    installed: async () =>
      page.evaluate(() => (window as ProbeWindow).__telaNetProbe?.installed === true),
  }
}
