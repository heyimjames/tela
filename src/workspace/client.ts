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
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    // Browsers only. Node's fetch ignores it, which is why the client also offers a
    // `headers` hook — irrelevant here, since this app is the browser side.
    credentials: 'include',
  })
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
