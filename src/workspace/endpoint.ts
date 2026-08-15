/**
 * Where the hosted API lives.
 *
 * A leaf module with no imports, mirroring `src/ai/endpoint.ts`. The adapter, the
 * session controller and the tests all need this constant, and routing it through
 * a module that imports either of the other two would build a cycle.
 *
 * **The default is relative, and relative is the deployment.** The app and the API
 * are served from one origin, so `/` sends every request same-origin: the session
 * cookie rides along without a CORS preflight, without `SameSite=None`, and
 * without an absolute host compiled into an artifact that ships to other people's
 * machines. `VITE_WORKSPACE_API_BASE_URL` exists for a dev server proxied onto a
 * different port, not as a supported production shape.
 *
 * Nothing here opens a connection. This module names an address; it does not dial it.
 */

/**
 * Base URL passed to the generated client.
 *
 * Trailing slashes are the client's problem — it normalises them in its constructor —
 * so this only has to produce something non-empty. Empty or whitespace means "same
 * origin", which the client turns into paths like `/v1/auth/login`.
 */
export const WORKSPACE_API_BASE_URL: string = readBaseUrl()

function readBaseUrl(): string {
  const raw = (import.meta.env?.VITE_WORKSPACE_API_BASE_URL as string | undefined) ?? ''
  const trimmed = raw.trim()
  return trimmed === '' ? '/' : trimmed
}
