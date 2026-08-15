/**
 * Where the hosted API lives.
 *
 * A leaf module with no imports, mirroring `src/ai/endpoint.ts`. The adapter, the
 * session controller and the tests all need this constant, and routing it through
 * a module that imports either of the other two would build a cycle.
 *
 * **The default is `/api`, because that is where the deployment mounts the API.**
 * The app and the API share one origin — the session cookie rides along without a
 * CORS preflight, without `SameSite=None`, and without an absolute host compiled
 * into an artifact that ships to other people's machines — but *same origin* is
 * not *same path*. The reverse proxy in front of `design.gethivemind.co` routes
 * `/api/*` to the API container and serves the single-page app everywhere else
 * (CLI-519; `docs/workspace-deployment.md` carries the contract this repo pins
 * against). `VITE_WORKSPACE_API_BASE_URL` exists for a dev server proxied onto a
 * different port, or a harness that mounts the API somewhere else — not as the
 * thing production depends on.
 *
 * The default used to be `'/'`, with a comment asserting that relative *was* the
 * deployment. It was not, and the failure had no red anywhere: a login POSTed to
 * `/v1/auth/login` at the origin root fell through to the SPA fallback, which
 * answers `index.html` with **HTTP 200**. The generated client expects `200` on
 * login, so it never raised; `response.json()` then threw a `SyntaxError`, which
 * is not an `ApiError`, so the login screen's catch-all rendered "Email or
 * password is incorrect." for a perfectly valid credential. Two guards came out
 * of that and both matter: this default is pinned against the deployment contract
 * by `__tests__/deploymentContract.test.ts`, and a response that is not shaped
 * like this API's is refused at the fetch seam by `responseShape.ts` rather than
 * being allowed to look like a rejected password. (CLI-559.)
 *
 * Nothing here opens a connection. This module names an address; it does not dial it.
 */

/**
 * The path the deployment mounts the API under, with no trailing slash.
 *
 * Exported so the contract test can compare *this* value against the deployment
 * document, rather than restating a literal that would then agree with itself.
 */
export const DEPLOYMENT_API_MOUNT = '/api'

/**
 * Base URL passed to the generated client.
 *
 * Trailing slashes are the client's problem — it normalises them in its constructor —
 * so this only has to produce something non-empty.
 *
 * Empty and whitespace-only both mean *unset*, and unset means the deployment
 * mount. They are deliberately not read as "same origin, at the root": an
 * environment that exports the variable as the empty string is one that failed to
 * fill it in, and resolving that to `/` is precisely the shape that shipped the
 * CLI-559 defect. A harness that really does serve the API from the origin root
 * says so with `VITE_WORKSPACE_API_BASE_URL=/`.
 */
export const WORKSPACE_API_BASE_URL: string = readBaseUrl()

function readBaseUrl(): string {
  const raw = (import.meta.env?.VITE_WORKSPACE_API_BASE_URL as string | undefined) ?? ''
  const trimmed = raw.trim()
  return trimmed === '' ? DEPLOYMENT_API_MOUNT : trimmed
}
