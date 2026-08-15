/**
 * Workspace-mode session cookie behaviour, in a real browser (CLI-538, from CLI-517).
 *
 * CLI-517 proved the session rules at the controller level: `login` sets the screen,
 * a `401` routes back to sign-in, `logout` clears state. What no test in this repo
 * could reach is the part that is not the controller's at all — whether the *browser*
 * stores the cookie the server sets, puts it back on the next authenticated call, and
 * drops it at logout. That behaviour lives in one option (`credentials: 'include'` in
 * `src/workspace/client.ts`) and in the browser's cookie jar, and a Node-side test has
 * neither.
 *
 * The subject is a `VITE_WORKSPACE_MODE=true` build served from its own directory and
 * its own origin, against the stub API in `stub-server.mjs` — never the real backend
 * (see that file's header for why), and never `page.route`, which would answer inside
 * the browser and so could not distinguish a request the app sent from one it did not.
 *
 * The evidence is the stub's own request log: what arrived on the wire, with or
 * without a cookie. The last assertion in each test checks the log contains **both**
 * kinds, because a log of only-cookied requests and a log the app never wrote to look
 * the same to an assertion that just counts the cookied ones.
 */

import { expect, test, type Page } from '@playwright/test'

/** Mirrors what `stub-server.mjs` records. */
interface LoggedRequest {
  readonly method: string
  readonly path: string
  readonly cookiePresent: boolean
  readonly cookieIsLiveSession: boolean
}

const COOKIE_NAME = 'hmd_session'
const EMAIL = 'gate@example.invalid'
const PASSWORD = 'stub-password-not-a-secret'

async function stubLog(page: Page): Promise<LoggedRequest[]> {
  const response = await page.request.get('/__stub__/requests')
  expect(response.ok(), 'the stub server did not answer its own request log').toBe(true)
  return ((await response.json()) as { requests: LoggedRequest[] }).requests
}

async function sessionCookie(page: Page): Promise<{ value: string; httpOnly: boolean } | null> {
  const cookies = await page.context().cookies()
  const found = cookies.find((cookie) => cookie.name === COOKIE_NAME)
  return found === undefined ? null : { value: found.value, httpOnly: found.httpOnly }
}

test.describe('workspace mode session cookie', () => {
  test('is set on login, sent on API calls, and cleared on logout', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/')

    // Workspace mode is on: the gate owns the screen before the editor. If this build
    // were default mode the editor would render instead, and every assertion below
    // would be about an app that has no session at all.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    expect(await sessionCookie(page), 'a session cookie exists before anyone signed in').toBeNull()

    // ---- Login ----------------------------------------------------------
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Reaching the library means the login response was accepted *and* the workspace
    // listing that follows it succeeded — and that listing is an authenticated call,
    // so it could only have succeeded with the cookie attached.
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()

    const afterLogin = await sessionCookie(page)
    expect(afterLogin, 'the browser did not store the session cookie the login response set').not.toBeNull()
    expect(afterLogin!.value.length).toBeGreaterThan(0)
    expect(afterLogin!.httpOnly, 'the session cookie is readable from script').toBe(true)

    const loggedIn = await stubLog(page)
    const login = loggedIn.find((entry) => entry.path === '/v1/auth/login')
    expect(login, 'the app never called the login route').toBeDefined()
    expect(
      login!.cookiePresent,
      'a session cookie was sent with the login request — the jar was not clean',
    ).toBe(false)

    const documents = loggedIn.find((entry) => entry.path.endsWith('/documents'))
    expect(documents, 'the app never made an authenticated call after signing in').toBeDefined()
    expect(
      documents!.cookiePresent,
      'the authenticated request arrived without a session cookie — credentials are not being included',
    ).toBe(true)
    expect(
      documents!.cookieIsLiveSession,
      'the cookie sent was not the session the login response minted',
    ).toBe(true)

    console.log(
      `[workspace cookies] login_cookie_sent=${login!.cookiePresent} ` +
        `documents_cookie_sent=${documents!.cookiePresent} jar_has_session=true http_only=${afterLogin!.httpOnly}`,
    )

    // ---- Logout ---------------------------------------------------------
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    expect(
      await sessionCookie(page),
      'the session cookie survived logout — the browser was never told to drop it',
    ).toBeNull()

    // The jar being empty is one half. The other half is what now goes on the wire:
    // an authenticated call made after logout must arrive with nothing attached, and
    // the server must refuse it.
    const status = await page.evaluate(async () => {
      // `/api/...`, because that is where the deployment — and this gate's stub —
      // mount the API. A bare `/v1/auth/me` would reach the SPA fallback and answer
      // 200 with `index.html`, which is CLI-559's failure verbatim.
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' })
      return response.status
    })
    expect(status, 'a call made after logout was still authenticated').toBe(401)

    const afterLogout = await stubLog(page)
    const me = afterLogout.find((entry) => entry.path === '/v1/auth/me')
    expect(me, 'the post-logout probe never reached the server').toBeDefined()
    expect(me!.cookiePresent, 'a session cookie was still sent after logout').toBe(false)

    // Non-vacuity: the log must contain both kinds. Without this, a log that recorded
    // `cookiePresent: false` for everything — because the recorder broke, or because
    // the app never sent anything — would satisfy every "no cookie" assertion above.
    expect(
      afterLogout.some((entry) => entry.cookiePresent),
      'no request in the whole run carried a cookie — the stub cannot observe one',
    ).toBe(true)
    expect(afterLogout.some((entry) => !entry.cookiePresent)).toBe(true)

    console.log(
      `[workspace cookies] logout jar_has_session=false post_logout_me_status=${status} ` +
        `requests_with_cookie=${afterLogout.filter((entry) => entry.cookiePresent).length} ` +
        `requests_without_cookie=${afterLogout.filter((entry) => !entry.cookiePresent).length}`,
    )
  })
})
