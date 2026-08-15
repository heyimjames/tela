/**
 * The guard that stops a wrong-shape response from impersonating a real answer.
 *
 * A leaf module: it imports nothing, so `client.ts` (the fetch seam) and
 * `errors.ts` (the user-facing wording) can both depend on it without a cycle.
 *
 * ## The failure it exists for
 *
 * CLI-559, in production. A build compiled with the wrong API base path posted
 * `/v1/auth/login` to the origin root, where the single-page-app fallback answered
 * `index.html` with **HTTP 200**. Every layer then behaved exactly as written and
 * the result was still a lie:
 *
 *  - the generated client expects `200` from login, so it raised nothing;
 *  - `response.json()` threw a `SyntaxError`, which is not an `ApiError`;
 *  - `mapApiError` passes non-`ApiError` values through untouched, on purpose;
 *  - the login screen's catch-all says "Email or password is incorrect."
 *
 * So a routing fault was reported to the user as a credential fault, on a correct
 * password, with a 200 in the server logs. The category error is what this module
 * fixes: *a body that is not this API's body is not an answer at all*, and it must
 * never reach the code that decides what a failed answer means.
 *
 * ## Where it sits, and why there
 *
 * At the `fetch` seam, wrapping the function handed to the client — not inside any
 * one endpoint's error handling. Every request the generated client makes goes
 * through its single `request()`, which calls the injected `fetch` exactly once, so
 * guarding that function covers every route the client has and every route it grows
 * later. A check bolted onto `login()` would have fixed the one screen that
 * happened to be looked at, and left `putBundle`, the document list, and the health
 * probe reporting their own private nonsense.
 *
 * ## What counts as this API's shape
 *
 * The v1 contract answers in exactly three shapes: a JSON body (every route,
 * success or error envelope), a zip body (`GET .../bundle`), or no body at all
 * (`204` from logout). Anything else — `text/html` above all, which is what every
 * SPA fallback and proxy error page in the world serves — is refused here.
 *
 * The check is on the declared content type rather than on the bytes. It is
 * deliberately not "try to parse and see": reading the body to inspect it would
 * consume the stream the client is about to read, and buffering a bundle a second
 * time to hand back an intact `Response` would double the memory cost of every
 * download to catch a case the header already names. A server that lies in its
 * `Content-Type` is out of scope; a server that tells the truth about serving HTML
 * is the entire observed failure.
 */

/**
 * A response that did not come from this API — or came from the wrong address.
 *
 * Not an `ApiError` subclass, deliberately: `ApiError` means "the API answered,
 * and refused", and this means "whatever answered was not the API". Callers that
 * branch on `ApiError` must not silently absorb this one.
 */
export class UnexpectedResponseError extends Error {
  /** The status that came back — usually `200`, which is what made this so quiet. */
  readonly status: number
  /** The `Content-Type` as received, or `'(none)'` when the response declared none. */
  readonly contentType: string
  /** The URL the request went to, base path included. The diagnostic that matters. */
  readonly url: string

  constructor(details: { status: number; contentType: string; url: string }) {
    super(
      `Unexpected response from the server (is the API base URL right?): ` +
        `${details.url} answered ${details.status} with content type ${details.contentType}.`,
    )
    // Set explicitly: a downlevelled class extension can leave this as 'Error', and a
    // caller matching on the name would stop recognising it.
    this.name = 'UnexpectedResponseError'
    this.status = details.status
    this.contentType = details.contentType
    this.url = details.url
  }
}

/** Content types the v1 API is allowed to answer with. */
function isApiContentType(contentType: string): boolean {
  // Parameters (`; charset=utf-8`) are stripped; the essence is the type/subtype.
  const essence = contentType.split(';')[0]!.trim().toLowerCase()
  return (
    essence === 'application/json' ||
    // `+json` structured suffixes (`application/problem+json` and friends). The
    // frozen contract does not use them today; accepting them costs nothing and
    // stops this guard from becoming the reason a future envelope is unreachable.
    essence.endsWith('+json') ||
    essence === 'application/zip' ||
    essence === 'application/octet-stream'
  )
}

/**
 * Statuses that carry no body by definition, where an absent content type is correct.
 *
 * `204` is the API's logout. `205` and `304` are here for completeness rather than
 * because this API sends them — the rule is "no body means no content type", and
 * narrowing it to the one status in use today would make the guard fire on a
 * correct response the day the contract grows another.
 */
const BODILESS_STATUSES = new Set([204, 205, 304])

/**
 * Throw unless `response` is shaped like something the v1 API sends.
 *
 * Called for every response, before the client looks at its status — the whole
 * point is that `200` is not evidence of anything when the body is an HTML page.
 */
export function assertApiResponseShape(response: Response, url: string): void {
  const declared = response.headers.get('content-type')

  if (declared === null || declared.trim() === '') {
    // No declared type. Correct for a bodiless status, and correct for a `Content-Length: 0`
    // body; anything else is an undeclared payload, which this API never sends.
    if (BODILESS_STATUSES.has(response.status) || response.headers.get('content-length') === '0') {
      return
    }
    throw new UnexpectedResponseError({ status: response.status, contentType: '(none)', url })
  }

  if (isApiContentType(declared)) {
    return
  }

  throw new UnexpectedResponseError({ status: response.status, contentType: declared, url })
}
