/**
 * The one place a `DesignApiClient` is constructed.
 *
 * Three properties this module is responsible for:
 *
 * 1. **Lazy.** The client's constructor throws when no `fetch` exists, so building
 *    one at module scope would make importing this file fatal in a Node test
 *    without a global fetch — and this module is imported, transitively, by
 *    `src/storage/index.ts`, which every build loads. Nothing is constructed until
 *    somebody calls an API.
 * 2. **Cookies included.** The session is a `hmd_session` cookie, so
 *    `credentials: 'include'` is not optional. Without it the browser sends no
 *    cookie and every authenticated call answers `401`.
 * 3. **No host.** The base URL comes from `WORKSPACE_API_BASE_URL`, which defaults
 *    to same-origin. No absolute host is compiled into this app.
 *
 * Constructing a client does not open a connection. Importing this module in local
 * mode is inert.
 */

import { DesignApiClient } from '@performance-clickt/design-api-client'
import type { FetchLike } from '@performance-clickt/design-api-client'
import { WORKSPACE_API_BASE_URL } from './endpoint'

let cached: DesignApiClient | null = null

/** Overrides for tests: an injected `fetch` and/or an explicit base URL. */
export interface WorkspaceClientOptions {
  readonly fetch?: FetchLike
  readonly baseUrl?: string
}

/**
 * Build a client. Callers that want the shared one use `getDesignApiClient`.
 *
 * Exported separately so a test can hold its own client — with its own request log —
 * without touching the module-level instance the app uses.
 */
export function createDesignApiClient(options: WorkspaceClientOptions = {}): DesignApiClient {
  return new DesignApiClient({
    baseUrl: options.baseUrl ?? WORKSPACE_API_BASE_URL,
    fetch: options.fetch ?? browserFetch(),
    // Browsers only. Node's fetch ignores it, which is why the client also offers a
    // `headers` hook — irrelevant here, since this app is the browser side.
    credentials: 'include',
  })
}

/**
 * The ambient `fetch`, bound to its global.
 *
 * History, and why this survives the upstream fix. The generated client's default
 * used to be `globalThis.fetch` stored on an instance field and invoked as
 * `this.fetchImpl(url, init)` — which calls it with the client as its receiver.
 * CLI-538's browser-level cookie gate recorded that shape failing with
 * `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`, so this bind
 * was added here: the vendored directory is generated from the server repo's
 * `openapi/v1.yaml` and checked against its generator, so a hand edit there would be
 * reverted by the next regeneration. CLI-553 fixed the generator instead — its default
 * is now bound, and its call site is detached so even an injected unbound `fetch` is
 * safe — and CLI-555 re-vendored that client here.
 *
 * This function is therefore no longer load-bearing, and it is kept anyway, for two
 * reasons. It composes: binding an already-bound function is a no-op, and the value is
 * passed as an explicit `fetch`, which the client uses exactly as given. And it keeps
 * the app's guarantee independent of the vendored bytes, which advance on someone
 * else's schedule. `__tests__/clientFetchBinding.test.ts` pins both halves separately —
 * this consumer's, and the vendored default's — so removing either one fails a test
 * rather than quietly resting on the other.
 *
 * One caveat on the story, per CLI-553: a direct probe of the pinned Chromium 149,
 * Firefox 151 and WebKit 26.5 found all three accept any receiver for `fetch`, so the
 * `Illegal invocation` CLI-538 saw is not explained by the receiver mechanism and its
 * real cause is still open. The narrow reason stands regardless — a client should not
 * depend on an engine's tolerance for a receiver it was never given.
 *
 * Read at call time, not at module load: a test that replaces `globalThis.fetch`
 * before building a client would otherwise get the one captured at import.
 */
function browserFetch(): FetchLike | undefined {
  const ambient = globalThis.fetch
  // Left undefined where there is none, so the client raises its own "No fetch
  // available" TypeError rather than this file inventing a different failure.
  return ambient === undefined ? undefined : (ambient.bind(globalThis) as FetchLike)
}

/** The shared client, built on first use. */
export function getDesignApiClient(): DesignApiClient {
  if (cached === null) {
    cached = createDesignApiClient()
  }
  return cached
}

/**
 * Replace the shared client, or drop it when passed `null`.
 *
 * The seam tests use to point the app at a mocked HTTP boundary. Kept out of the
 * app's own code paths: nothing in `src/` calls this outside tests.
 */
export function setDesignApiClientForTests(client: DesignApiClient | null): void {
  cached = client
}
