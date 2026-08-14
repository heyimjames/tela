/**
 * The private browser.
 *
 * Lifecycle rules, each of which the architecture contract names and each of
 * which is load-bearing:
 *
 *  - **Lazy.** Nothing here runs until the first tool call that actually needs a
 *    browser. `buildServer()` must stay side-effect-free because a modern client
 *    may construct a disposable server purely to read the tool list, and
 *    launching Chromium to answer `tools/list` would be absurd.
 *  - **One browser per process, a fresh context per operation.** The browser is
 *    expensive and reusable; a context is cheap and is the isolation boundary. A
 *    render that leaves state behind cannot contaminate the next one.
 *  - **Private.** A browser this process launched and owns. Never an attach to
 *    the user's browser, which would put their cookies, extensions, and sessions
 *    one `page.evaluate` away from designs.
 *  - **Cleanup in `finally`.** Including on cancellation. An aborted export must
 *    not leak a context; a few hundred leaked contexts is a wedged machine.
 *
 * Communication is `page.evaluate(window.tela.dispatch)` — a direct, same-page
 * call into the app's own internal bus. Not a wildcard `postMessage`, which has
 * no authenticated sender and would accept commands from any frame that found
 * the window.
 */

import type { Browser, BrowserContext, Page } from 'playwright'

import { toolError } from '../errors'
import { log } from '../logging'
import { startBridgeServer, TOKEN_HEADER, type BridgeServer } from './appServer'
import { childEnvironment } from './childEnv'

interface BridgeState {
  server: BridgeServer
  browser: Browser
}

let state: BridgeState | null = null
let starting: Promise<BridgeState> | null = null

export function bridgeStarted(): boolean {
  return state !== null
}

export function bridgeStatus(): { running: boolean; origin?: string } {
  return state ? { running: true, origin: state.server.origin } : { running: false }
}

/**
 * Start (or reuse) the bridge.
 *
 * The in-flight promise is shared so two concurrent first calls launch one
 * browser rather than two.
 */
async function ensureBridge(): Promise<BridgeState> {
  if (state) return state
  if (starting) return starting

  starting = (async () => {
    const server = await startBridgeServer()
    let browser: Browser
    try {
      const { chromium } = await import('playwright')
      // A payload ships its own pinned Chromium rather than depending on a
      // machine-wide Playwright cache, so the executable path is configurable.
      // It still resolves to a browser this process launches and owns — it is
      // never an attach to a running browser, whatever it points at.
      const executablePath = process.env.TELA_CHROMIUM_EXECUTABLE?.trim()
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        // No remote debugging port, no extensions, no user profile. The browser
        // has nothing in it and nothing pointing at it.
        args: ['--disable-extensions', '--disable-background-networking', '--no-first-run', '--disable-sync'],
        // Deny-by-default environment. Without this the browser inherits the
        // operator's shell — including proxy settings that would route the
        // "no outbound network" runtime through a third party, `LD_PRELOAD`/
        // `DYLD_INSERT_LIBRARIES`/`NODE_OPTIONS` that inject code into the
        // process rendering the designs, and every credential the shell happens
        // to be holding. Playwright passes this straight through to the browser
        // process, so it is the whole environment the child sees.
        env: childEnvironment(),
      })
    } catch (cause) {
      await server.close()
      throw toolError(
        'bridge_failed',
        `the private browser could not be launched (${cause instanceof Error ? cause.message : String(cause)})`,
        'install the pinned Playwright Chromium for this payload (`npx playwright install chromium` during setup, never at runtime) and retry; rendering and export need it, but every other tool works without it',
      )
    }
    const next: BridgeState = { server, browser }
    state = next
    log({ level: 'info', traceId: 'bridge', event: 'bridge.started', detail: 'loopback app server and private browser are up' })
    return next
  })()

  try {
    return await starting
  } finally {
    starting = null
  }
}

export async function stopBridge(): Promise<void> {
  const current = state
  state = null
  if (!current) return
  await current.browser.close().catch(() => {})
  await current.server.close().catch(() => {})
  log({ level: 'info', traceId: 'bridge', event: 'bridge.stopped' })
}

export interface OperationHandle {
  page: Page
  dispatch: <T>(command: Record<string, unknown>) => Promise<T>
}

/**
 * Run `work` against a freshly loaded app page in its own context.
 *
 * `signal` is honoured at three points — before the context is created, after
 * the page has loaded, and by the `abort` listener that closes the context out
 * from under a running evaluate. The listener is what makes cancellation
 * *effective* rather than merely observed: without it a cancelled 4× export
 * still runs to completion, burning the CPU the client asked us to stop using.
 */
export async function withOperation<T>(
  signal: AbortSignal,
  work: (handle: OperationHandle) => Promise<T>,
  options: { viewport?: { width: number; height: number }; deviceScaleFactor?: number } = {},
): Promise<T> {
  throwIfAborted(signal)
  const bridge = await ensureBridge()
  throwIfAborted(signal)

  let context: BrowserContext | undefined
  const onAbort = () => {
    context?.close().catch(() => {})
  }
  try {
    context = await bridge.browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 800 },
      deviceScaleFactor: options.deviceScaleFactor ?? 1,
      // Applied to every request the context makes, which is how the bridge
      // server's token requirement is satisfied without putting the secret in a
      // URL that could end up in a referrer or a log.
      extraHTTPHeaders: { [TOKEN_HEADER]: bridge.server.token },
      serviceWorkers: 'block',
    })
    signal.addEventListener('abort', onAbort, { once: true })

    // Belt and braces against the "no external network" contract: anything not
    // pointed at the private loopback origin is refused at the browser, not
    // merely absent by convention.
    await context.route('**/*', (route) => {
      if (route.request().url().startsWith(bridge.server.origin)) return route.continue()
      return route.abort()
    })

    const page = await context.newPage()
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto(bridge.server.appUrl, { waitUntil: 'load' })
    await page.waitForFunction(
      () => typeof (window as unknown as { tela?: { dispatch?: unknown } }).tela?.dispatch === 'function',
      undefined,
      { timeout: 30_000 },
    ).catch(() => {
      throw toolError(
        'bridge_failed',
        `the bundled application did not finish booting${consoleErrors.length > 0 ? ` (${consoleErrors[0]})` : ''}`,
        'rebuild the bridge payload with `npm run build:bridge` and retry; the build being served may be stale or incomplete',
      )
    })
    throwIfAborted(signal)

    const dispatch = async <R,>(command: Record<string, unknown>): Promise<R> => {
      const result = (await page.evaluate(
        (payload) => (window as unknown as { tela: { dispatch: (c: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }> } }).tela.dispatch(payload),
        command,
      )) as { ok: boolean; result?: unknown; error?: string }
      if (!result.ok) {
        throw toolError(
          'bridge_failed',
          `the renderer refused the operation (${result.error ?? 'no reason given'})`,
          'check the frame\'s layers with tela_get_scene; a malformed layer or a missing asset is the usual cause',
        )
      }
      return result.result as R
    }

    return await work({ page, dispatch })
  } finally {
    signal.removeEventListener('abort', onAbort)
    await context?.close().catch(() => {})
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw toolError('cancelled', 'the operation was cancelled by the client', 'reissue the call if the cancellation was not intended')
  }
}
