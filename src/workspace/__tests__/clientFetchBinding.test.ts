/**
 * The app's client must call `fetch` with a receiver a browser will accept.
 *
 * The defect this pins, found by CLI-538's browser-level cookie gate: the generated
 * client's default is `globalThis.fetch` kept on an instance field and invoked as
 * `this.fetchImpl(url, init)`. That passes the *client* as the receiver. Node's
 * `fetch` does not check, so every test in this repo passed; `Window.fetch`
 * brand-checks and throws `Illegal invocation`, so in a real browser workspace mode
 * could not make a single request — login, list, open, save and logout all failed
 * before anything reached the network.
 *
 * A Node test can reach that only by reproducing the check, which is what the double
 * below does: a `fetch` that refuses any receiver but `globalThis`. The control
 * matters as much as the assertion — it builds a client the vendored default way and
 * requires it to fail. Without that, a double whose check never fired would let this
 * file pass with the fix removed, which is the whole class of test this project's
 * Lessons Log exists to prevent.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { DesignApiClient } from '@performance-clickt/design-api-client'
import { createDesignApiClient } from '../client'

const CREDENTIALS = { email: 'someone@example.invalid', password: 'not-a-real-password' }
const SESSION = { user: { id: 'u1', email: CREDENTIALS.email }, workspaces: [] }

const originalFetch = globalThis.fetch

/** A `fetch` that refuses any receiver but its global, exactly as a browser's does. */
function installBrandCheckedFetch(): void {
  globalThis.fetch = function brandChecked(this: unknown): Promise<Response> {
    if (this !== globalThis && this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
    }
    return Promise.resolve(
      new Response(JSON.stringify(SESSION), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  } as typeof globalThis.fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('the workspace API client under a brand-checking fetch', () => {
  it('calls fetch with a receiver the browser accepts', async () => {
    installBrandCheckedFetch()

    // The absolute expectation, not a comparison against another call: a session
    // payload comes back, which can only happen if the request was actually made.
    await expect(createDesignApiClient({ baseUrl: '/' }).login({ body: CREDENTIALS })).resolves.toMatchObject({
      user: { email: CREDENTIALS.email },
    })
  })

  it('the double can fail: the vendored default receiver is refused', async () => {
    installBrandCheckedFetch()

    // Built the way `createDesignApiClient` used to build it — no explicit `fetch`,
    // so the client falls back to its own unbound `globalThis.fetch`. This must
    // throw; if it does not, the double is not checking anything and the assertion
    // above proves nothing.
    await expect(
      new DesignApiClient({ baseUrl: '/', credentials: 'include' }).login({ body: CREDENTIALS }),
    ).rejects.toThrow(/Illegal invocation/)
  })

  it('leaves an injected fetch alone', async () => {
    installBrandCheckedFetch()
    let seen = 0
    const injected = (): Promise<Response> => {
      seen += 1
      return Promise.resolve(
        new Response(JSON.stringify(SESSION), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    }

    await createDesignApiClient({ baseUrl: '/', fetch: injected }).login({ body: CREDENTIALS })
    expect(seen, 'the injected fetch was replaced by the ambient one').toBe(1)
  })
})
