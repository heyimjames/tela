/**
 * Reading an invite token out of the URL.
 *
 * A pure function over the query string rather than a `useEffect` that pokes at
 * `window.location`, for the reason the Lessons Log records against CLI-513: a gate
 * that lives inside an effect cannot be asserted by rendering, so the condition gets
 * extracted and the *condition* is what the test pins.
 */

/**
 * The invite token in `search`, or `null`.
 *
 * Whitespace-only is `null`: an `?invite=` with nothing after it is a truncated
 * link, and treating it as a token would show the user an invite form that cannot
 * possibly succeed.
 */
export function readInviteToken(search: string): string | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  } catch {
    return null
  }
  const raw = params.get('invite')
  if (raw === null) {
    return null
  }
  const token = raw.trim()
  return token === '' ? null : token
}
