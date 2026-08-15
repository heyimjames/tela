/**
 * A wrong-shape response must never be reported as a wrong credential (CLI-559).
 *
 * The production failure was not "an error was mishandled". It was an error that was
 * never recognised as one: a single-page-app fallback answered a misrouted login with
 * `index.html` at **HTTP 200**, the generated client saw the status it expected, and
 * the only thing that finally went wrong was `JSON.parse` — a `SyntaxError`, thrown
 * far from anything that knew what the request had been. The login screen's catch-all
 * called it a bad password.
 *
 * These tests are written at the seams that failure crossed, not at the guard's own
 * function:
 *
 *  - through the **session controller**, so what is asserted is the sentence a user
 *    reads, and the assertion that matters most is a negative — the credential
 *    message must not appear;
 *  - through the **generated client**, for routes that have no screen of their own,
 *    because a guard that only covers login would have left every other call
 *    inventing its own private nonsense;
 *  - with **controls**, because "no credential message" is satisfiable by breaking
 *    login entirely. A genuine `401` must still say "Email or password is incorrect."
 *    in the same file, or these tests are pinning a broken screen rather than a
 *    working guard.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchLike } from '@performance-clickt/design-api-client'
import { WorkspaceStorageAdapter } from '@/storage/WorkspaceStorageAdapter'
import { createDesignApiClient, setDesignApiClientForTests } from '../client'
import { UnexpectedResponseError } from '../responseShape'
import {
  acceptInvite,
  configureWorkspaceSession,
  getWorkspaceState,
  login,
  refreshDocuments,
  resetWorkspaceSessionForTests,
  selectWorkspace,
} from '../session'
import { FakeServer, fakeBundle } from './fakeServer'
import type { DocumentBridge } from '../documentBridge'

const CREDENTIALS = { email: 'designer@example.test', password: 'correct horse battery staple' }
const CREDENTIAL_MESSAGE = 'Email or password is incorrect.'

/** The page a proxy serves when nothing matched — the whole cause, in one response. */
const SPA_FALLBACK = '<!doctype html><html><head><title>Tela</title></head><body></body></html>'

/**
 * A `fetch` that answers every request the way the misconfigured deployment did.
 *
 * `200`, `text/html`, a page of markup. Not a rejection, not a `404`: the defect is
 * precisely that the wire looked healthy.
 */
function spaFallbackFetch(): FetchLike {
  return () =>
    Promise.resolve(
      new Response(SPA_FALLBACK, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
}

function bridge(): DocumentBridge {
  let buffer = fakeBundle('Poster', { v: 'local' })
  return {
    capture: () => buffer,
    apply: async (bundle) => {
      buffer = bundle
    },
    download: () => {},
  }
}

/** Point the session controller at a given `fetch`, as `session.test.ts` does. */
function wire(fetchImpl: FetchLike, workspaceId = 'ws-1') {
  const client = createDesignApiClient({ fetch: fetchImpl, baseUrl: '/' })
  setDesignApiClientForTests(client)
  configureWorkspaceSession({
    bridge: bridge(),
    adapter: new WorkspaceStorageAdapter({ client: () => client, workspaceId: () => workspaceId }),
  })
  return client
}

describe('a response that is not shaped like this API', () => {
  beforeEach(() => {
    resetWorkspaceSessionForTests()
    setDesignApiClientForTests(null)
  })

  it('is not reported to the user as a wrong password', async () => {
    wire(spaFallbackFetch())

    await login(CREDENTIALS.email, CREDENTIALS.password)

    const notice = getWorkspaceState().notice
    // The negative first, and stated absolutely: this exact sentence is the defect.
    expect(notice).not.toBe(CREDENTIAL_MESSAGE)
    expect(notice).not.toMatch(/password/i)
    // And the positive, so "not the credential message" cannot be satisfied by a
    // blank screen, a null notice, or a generic shrug.
    expect(notice).toMatch(/unexpected response/i)
    expect(notice).toMatch(/API address/i)
    // Nobody was let in on the strength of an HTML page.
    expect(getWorkspaceState().screen).toBe('signed-out')
    expect(getWorkspaceState().user).toBeNull()
  })

  it('still lets a genuine 401 say the credentials were wrong', async () => {
    // The control. Without it, a guard that classified *every* failure as a
    // wrong-shape response would pass the test above while destroying the real
    // credential message — the same class of mistake in the opposite direction.
    const server = new FakeServer()
    wire(server.fetch)

    await login(CREDENTIALS.email, 'wrong')

    expect(getWorkspaceState().notice).toBe(CREDENTIAL_MESSAGE)
  })

  it('is not reported as an expired invite either', async () => {
    wire(spaFallbackFetch())

    const result = await acceptInvite('some-token', 'a-password')

    expect(result).toBeNull()
    expect(getWorkspaceState().notice).not.toMatch(/invite is no longer valid/i)
    expect(getWorkspaceState().notice).toMatch(/unexpected response/i)
  })

  it('is refused on a document call, not only on the auth screens', async () => {
    // The library is reached through a working server, and only then does the
    // deployment answer nonsense — the shape of a proxy that is fine for the login
    // route and misrouted for everything else. Reaching the state honestly is what
    // makes this an assertion about `refreshDocuments`, not about login again.
    const server = new FakeServer()
    wire(server.fetch)
    await login(CREDENTIALS.email, CREDENTIALS.password)
    expect(getWorkspaceState().screen).toBe('library')

    wire(spaFallbackFetch(), server.workspaceId)
    selectWorkspace(server.workspaceId)
    await refreshDocuments()

    expect(getWorkspaceState().notice).toMatch(/unexpected response/i)
  })

  it('is refused on every route the client has, at the fetch seam', async () => {
    // Below the app entirely: the guard wraps the `fetch` the generated client calls,
    // so each of these rejects for the same reason without any per-route wiring. A
    // guard added to one endpoint's error handling would fail this test on the second
    // call — which is the point of enumerating rather than sampling.
    const client = createDesignApiClient({ fetch: spaFallbackFetch(), baseUrl: '/' })

    await expect(client.getHealth()).rejects.toBeInstanceOf(UnexpectedResponseError)
    await expect(client.login({ body: CREDENTIALS })).rejects.toBeInstanceOf(UnexpectedResponseError)
    await expect(client.logout()).rejects.toBeInstanceOf(UnexpectedResponseError)
    await expect(
      client.listDocuments({ workspaceId: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toBeInstanceOf(UnexpectedResponseError)
  })

  it('carries the address it was pointed at, because that is the fix', async () => {
    const client = createDesignApiClient({ fetch: spaFallbackFetch(), baseUrl: '/wrong-base' })

    const raised = await client.getHealth().then(
      () => null,
      (error: unknown) => error,
    )

    expect(raised).toBeInstanceOf(UnexpectedResponseError)
    const error = raised as UnexpectedResponseError
    expect(error.url).toBe('/wrong-base/healthz')
    expect(error.status).toBe(200)
    expect(error.contentType).toBe('text/html; charset=utf-8')
  })

  it('lets the API’s own shapes through', async () => {
    // The other half of non-vacuity: a guard that threw on everything would satisfy
    // every assertion above. JSON, zip and a bodiless `204` all have to pass, and the
    // whole of `session.test.ts` and the adapter suite run through this same wrapper,
    // which is the broader version of this check.
    const server = new FakeServer({
      documents: [
        {
          id: 'doc-1',
          title: 'Poster',
          contentRevision: null,
          bundle: null,
          archivedAt: null,
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    })
    const client = createDesignApiClient({ fetch: server.fetch, baseUrl: '/' })

    await expect(client.login({ body: CREDENTIALS })).resolves.toMatchObject({
      user: { email: CREDENTIALS.email },
    })
    // `204`, no body, no content type — correct, and must not be refused.
    await expect(client.logout()).resolves.toBeUndefined()
  })
})
