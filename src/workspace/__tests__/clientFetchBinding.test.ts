/**
 * The app's client must call `fetch` with a receiver a browser will accept.
 *
 * Background, stated as measured rather than inherited. CLI-538's browser-level
 * cookie gate recorded `TypeError: Failed to execute 'fetch' on 'Window': Illegal
 * invocation` against the then-vendored client, whose default was `globalThis.fetch`
 * kept on an instance field and invoked as `this.fetchImpl(url, init)` — i.e. with
 * the *client* as receiver. CLI-553 probed that receiver question directly in the
 * pinned Chromium 149 (the build `playwright@1.61.1` ships, the one that gate ran),
 * Firefox 151 and WebKit 26.5, and all three accept any receiver for `fetch`, so the
 * failure is not universal and its true cause is still open. The protection stands on
 * the narrower ground that a client must not depend on an engine's tolerance for a
 * receiver it was never given.
 *
 * A Node test reaches that only by reproducing the check, which is what the double
 * below does: a `fetch` that refuses any receiver but `globalThis`.
 *
 * The control matters as much as the assertions. It used to build a client the
 * vendored default way and require it to fail — but CLI-553 fixed the generator, so
 * the vendored default no longer fails, and a control aimed at it would now be
 * asserting a defect that no longer exists (CLI-555 re-vendored the fix at source
 * commit `6f4d56d`). The control therefore hand-builds the pre-fix shape instead: it
 * proves the double can fail without depending on shipped code being broken. What the
 * vendored default *does* now do is pinned separately, and positively.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { DesignApiClient } from '@performance-clickt/design-api-client'
import { createDesignApiClient } from '../client'

const CREDENTIALS = { email: 'someone@example.invalid', password: 'not-a-real-password' }
const SESSION = { user: { id: 'u1', email: CREDENTIALS.email }, workspaces: [] }

const originalFetch = globalThis.fetch

/**
 * A `fetch` that refuses any receiver but its global, exactly as a browser's does —
 * and that records the receiver of every call it accepts.
 *
 * The recording is not decoration. A detached call site passes `undefined`, which a
 * brand check tolerates, so "the request succeeded" is satisfied whether or not the
 * default was bound: the two protections mask each other from the outside. Pinning
 * the bind therefore means asserting *which* receiver arrived, not that a call went
 * through. Verified by mutation — unbinding the vendored default leaves a
 * success-only assertion green.
 */
function installBrandCheckedFetch(): unknown[] {
  const receivers: unknown[] = []
  globalThis.fetch = function brandChecked(this: unknown): Promise<Response> {
    if (this !== globalThis && this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
    }
    receivers.push(this)
    return Promise.resolve(
      new Response(JSON.stringify(SESSION), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  } as typeof globalThis.fetch
  return receivers
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('the workspace API client under a brand-checking fetch', () => {
  it('calls fetch with a receiver the browser accepts', async () => {
    const receivers = installBrandCheckedFetch()

    // The absolute expectation, not a comparison against another call: a session
    // payload comes back, which can only happen if the request was actually made.
    await expect(createDesignApiClient({ baseUrl: '/' }).login({ body: CREDENTIALS })).resolves.toMatchObject({
      user: { email: CREDENTIALS.email },
    })
    // This app binds before injecting, so the global itself arrives as the receiver.
    expect(receivers).toEqual([globalThis])
  })

  it('the double can fail: the pre-fix shape is refused', async () => {
    installBrandCheckedFetch()

    // The shape the vendored client used to emit, rebuilt by hand: the ambient
    // `fetch` lifted onto an object and invoked as a method of that object, so the
    // object is the receiver. This must throw. If it does not, the double is not
    // checking anything and every assertion in this file proves nothing.
    //
    // Hand-built rather than obtained from the vendored client, deliberately: tying
    // the control to shipped code means the control only works while that code is
    // broken, and it breaks — loudly and confusingly — the moment the defect is
    // fixed. That is exactly what happened when CLI-553 fixed it upstream.
    const preFix = { fetchImpl: globalThis.fetch }
    expect(() => preFix.fetchImpl('/v1/auth/login')).toThrow(/Illegal invocation/)
  })

  it('the vendored default is bound to the global, not merely accepted', async () => {
    const receivers = installBrandCheckedFetch()

    // No `fetch` injected, so the client falls back to its own default. Before
    // CLI-553 that default was unbound; the re-vendored client binds it to
    // `globalThis`.
    await expect(
      new DesignApiClient({ baseUrl: '/', credentials: 'include' }).login({ body: CREDENTIALS }),
    ).resolves.toMatchObject({ user: { email: CREDENTIALS.email } })

    // The assertion that actually pins the bind. Success alone cannot: the client's
    // detached call site would hand an *unbound* default over as `undefined`, which
    // this double tolerates, so the request would still succeed with the bind gone.
    // Requiring `globalThis` specifically is what makes removing the bind fail here.
    expect(receivers).toEqual([globalThis])
  })

  it('an injected fetch may itself be unbound: the client calls it detached', async () => {
    const receivers = installBrandCheckedFetch()

    // The half the bind cannot cover — a caller passing an unbound `window.fetch`.
    // The vendored client reads its stored fetch into a local before calling, so the
    // receiver is `undefined` rather than the client. This is the property that lets
    // any consumer inject a bare global without knowing to bind it first.
    const unbound = globalThis.fetch
    await expect(
      createDesignApiClient({ baseUrl: '/', fetch: unbound }).login({ body: CREDENTIALS }),
    ).resolves.toMatchObject({ user: { email: CREDENTIALS.email } })

    // `undefined`, not the client: the injected function was neither re-bound (which
    // would show `globalThis`) nor invoked as a method (which would have thrown).
    expect(receivers).toEqual([undefined])
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
