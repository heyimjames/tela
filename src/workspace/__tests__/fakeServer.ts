/**
 * A fake of the v1 API, mocked **at the HTTP boundary**.
 *
 * Not a stubbed client and not a mocked adapter: this is a `fetch` that speaks the
 * wire format, so everything above it — the generated client's URL building, header
 * handling, status branching and error typing, then this app's error translation,
 * then the adapter, then the session controller — runs for real. A test that stubbed
 * the client would prove the app calls a function; this proves the app survives what
 * the server actually sends.
 *
 * It implements the concurrency rule properly rather than returning a canned `409`,
 * because the conflict path is the one behaviour CLI-517 exists to get right:
 *
 *  - a `PUT` whose `X-Base-Content-Revision` does not equal the stored revision is
 *    refused, **and nothing is written** — enforced here, so a test can assert the
 *    stored bytes afterwards and catch a fake that "refused" but mutated anyway;
 *  - `contentRevision` covers creative content only, so a body differing only in
 *    its title reproduces the rename quirk: `200`, no new revision, earlier bytes
 *    kept, and the stored `bundleSha256` returned.
 *
 * Every request is appended to `requests` before it is answered, including ones that
 * fail. That log is how a test asserts a *negative* — that no retry was issued —
 * without reading the implementation.
 */

import { createHash } from 'node:crypto'
import type { FetchLike } from '@performance-clickt/design-api-client'

export interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly path: string
  readonly headers: Record<string, string>
  readonly bodyBytes: Uint8Array | null
}

export interface FakeDocument {
  id: string
  title: string
  /** `null` until the first successful `PUT`. */
  contentRevision: string | null
  bundle: Uint8Array | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FakeServerOptions {
  readonly workspaceId?: string
  readonly email?: string
  readonly password?: string
  readonly documents?: FakeDocument[]
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/**
 * The stand-in for "creative content".
 *
 * The real server hashes the document's creative content, excluding the title. The
 * `.tela` bundles these tests carry are `{"title":…,"content":…}` JSON, so the
 * revision is taken over `content` alone. That reproduces the property the app has
 * to cope with — two different byte strings sharing a revision — without pulling a
 * zip writer into a unit test.
 */
function contentRevisionOf(bundle: Uint8Array): string {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bundle)) as { content?: unknown }
    return sha256(new TextEncoder().encode(JSON.stringify(parsed.content ?? null)))
  } catch {
    return sha256(bundle)
  }
}

export class FakeServer {
  readonly requests: RecordedRequest[] = []
  readonly workspaceId: string
  readonly documents = new Map<string, FakeDocument>()

  private readonly email: string
  private readonly password: string
  private authenticated = false
  /** Set by a test to make the *next* authenticated call answer `401`. */
  expireSessionOnNextCall = false
  /** Set by a test to make login answer `429`. */
  rateLimitLoginFor: number | null = null

  constructor(options: FakeServerOptions = {}) {
    this.workspaceId = options.workspaceId ?? '11111111-1111-4111-8111-111111111111'
    this.email = options.email ?? 'designer@example.test'
    this.password = options.password ?? 'correct horse battery staple'
    for (const document of options.documents ?? []) {
      this.documents.set(document.id, { ...document })
    }
  }

  /** Requests whose method and path match. Used to assert what was *not* sent. */
  requestsMatching(method: string, pathFragment: string): RecordedRequest[] {
    return this.requests.filter(
      (request) => request.method === method && request.path.includes(pathFragment),
    )
  }

  /** The `fetch` to hand the client. */
  get fetch(): FetchLike {
    return async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const url = input
      const path = url.split('?')[0] ?? url
      const headers = normaliseHeaders(init?.headers)
      const bodyBytes = await bodyToBytes(init?.body)
      this.requests.push({ method, url, path, headers, bodyBytes })
      return this.route(method, path, headers, bodyBytes)
    }
  }

  private route(
    method: string,
    path: string,
    headers: Record<string, string>,
    bodyBytes: Uint8Array | null,
  ): Response {
    const json = (status: number, body: unknown, extra?: Record<string, string>): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...extra },
      })

    if (method === 'POST' && path.endsWith('/v1/auth/login')) {
      if (this.rateLimitLoginFor !== null) {
        return json(429, { error: 'rate_limited', message: 'Too many attempts.' }, {
          'retry-after': String(this.rateLimitLoginFor),
        })
      }
      const body = decodeJson(bodyBytes) as { email?: string; password?: string }
      if (body.email !== this.email || body.password !== this.password) {
        // One body for both failure modes, exactly as the contract specifies.
        return json(401, { error: 'invalid_credentials', message: 'Invalid email or password.' })
      }
      this.authenticated = true
      return json(200, this.sessionPayload())
    }

    if (method === 'POST' && path.endsWith('/v1/auth/logout')) {
      this.authenticated = false
      return new Response(null, { status: 204 })
    }

    if (method === 'POST' && path.endsWith('/v1/auth/invites/accept')) {
      const body = decodeJson(bodyBytes) as { token?: string }
      if (body.token !== 'good-token') {
        return json(400, { error: 'invalid_invite', message: 'This invite is no longer valid.' })
      }
      return json(200, {
        email: this.email,
        workspace: { workspaceId: this.workspaceId, slug: 'studio', name: 'Studio', role: 'editor' },
        // Always false: this route never mints a session.
        authenticated: false,
      })
    }

    const unauthenticated = json(401, { error: 'unauthenticated', message: 'Sign in to continue.' })
    if (this.expireSessionOnNextCall) {
      this.expireSessionOnNextCall = false
      this.authenticated = false
      return unauthenticated
    }
    if (!this.authenticated) {
      return unauthenticated
    }

    if (method === 'GET' && path.endsWith('/v1/auth/me')) {
      return json(200, this.sessionPayload())
    }

    const documentsPrefix = `/v1/workspaces/${this.workspaceId}/documents`
    if (!path.includes('/v1/workspaces/')) {
      return json(404, { error: 'route_not_found', message: 'Not found.' })
    }
    if (!path.includes(documentsPrefix)) {
      // A workspace the caller is not a member of is indistinguishable from one that
      // does not exist — the same `404`, deliberately.
      return json(404, { error: 'not_found', message: 'Not found.' })
    }

    const rest = path.slice(path.indexOf(documentsPrefix) + documentsPrefix.length)

    if (rest === '' && method === 'GET') {
      return json(200, {
        documents: [...this.documents.values()]
          .filter((document) => document.archivedAt === null)
          .map((document) => this.summaryOf(document)),
      })
    }

    const archiveMatch = /^\/([^/]+)\/archive$/.exec(rest)
    if (archiveMatch !== null && method === 'POST') {
      const document = this.documents.get(decodeURIComponent(archiveMatch[1]!))
      if (document === undefined) {
        return json(404, { error: 'not_found', message: 'Not found.' })
      }
      document.archivedAt = document.archivedAt ?? '2026-08-15T00:00:00.000Z'
      return json(200, { id: document.id, archived: true })
    }

    const bundleMatch = /^\/([^/]+)\/bundle$/.exec(rest)
    if (bundleMatch !== null && method === 'GET') {
      const document = this.documents.get(decodeURIComponent(bundleMatch[1]!))
      if (document?.bundle == null || document.contentRevision === null) {
        // A document that has never been written has no bytes, and answers the same
        // `404` as one that does not exist.
        return json(404, { error: 'not_found', message: 'Not found.' })
      }
      return new Response(document.bundle as unknown as BodyInit, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          etag: `"${sha256(document.bundle)}"`,
          'x-content-revision': document.contentRevision,
        },
      })
    }

    const documentMatch = /^\/([^/]+)$/.exec(rest)
    if (documentMatch !== null) {
      const id = decodeURIComponent(documentMatch[1]!)
      const document = this.documents.get(id)
      if (method === 'GET') {
        return document === undefined
          ? json(404, { error: 'not_found', message: 'Not found.' })
          : json(200, this.summaryOf(document))
      }
      if (method === 'PUT') {
        return this.putBundle(document, headers, bodyBytes, json)
      }
    }

    if (rest === '' && method === 'POST') {
      const body = decodeJson(bodyBytes) as { title?: string }
      const id = `doc-${this.documents.size + 1}`
      this.documents.set(id, {
        id,
        title: body.title ?? 'Untitled',
        contentRevision: null,
        bundle: null,
        archivedAt: null,
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      })
      return json(201, { id })
    }

    return json(404, { error: 'route_not_found', message: 'Not found.' })
  }

  private putBundle(
    document: FakeDocument | undefined,
    headers: Record<string, string>,
    bodyBytes: Uint8Array | null,
    json: (status: number, body: unknown) => Response,
  ): Response {
    if (document === undefined) {
      return json(404, { error: 'not_found', message: 'Not found.' })
    }
    if (document.archivedAt !== null) {
      return json(409, { error: 'document_archived', message: 'This document is archived.' })
    }
    if (bodyBytes === null) {
      return json(400, { error: 'invalid_body', message: 'A bundle is required.' })
    }
    const rawBase = headers['x-base-content-revision']
    const base = rawBase === undefined || rawBase.trim() === '' ? null : rawBase

    if (base !== document.contentRevision) {
      // Refused. Nothing below this line writes, and a test asserts the stored bytes
      // are untouched afterwards — a fake that mutated here would make the whole
      // conflict suite meaningless.
      return json(409, {
        error: 'content_revision_conflict',
        message: 'This document changed since you opened it.',
        // `expected` is what the server holds; `actual` is what the caller sent.
        expected: document.contentRevision,
        actual: base,
      })
    }

    const revision = contentRevisionOf(bodyBytes)
    if (revision === document.contentRevision) {
      // Same creative content, different bytes — a rename. No revision to append,
      // so the earlier bytes stay, and the response reports the sha256 of what is
      // *stored*, not of what was sent.
      return json(200, {
        contentRevision: document.contentRevision,
        bundleSha256: sha256(document.bundle ?? bodyBytes),
      })
    }

    document.bundle = bodyBytes
    document.contentRevision = revision
    document.updatedAt = '2026-08-15T00:00:00.000Z'
    try {
      document.title = (JSON.parse(new TextDecoder().decode(bodyBytes)) as { title?: string }).title ?? document.title
    } catch {
      // Not JSON: leave the title alone. Real bundles carry it inside the archive.
    }
    return json(200, { contentRevision: revision, bundleSha256: sha256(bodyBytes) })
  }

  private summaryOf(document: FakeDocument): Record<string, unknown> {
    return {
      id: document.id,
      title: document.title,
      contentRevision: document.contentRevision,
      bundleSha256: document.bundle === null ? null : sha256(document.bundle),
      byteSize: document.bundle?.byteLength ?? null,
      archivedAt: document.archivedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }
  }

  private sessionPayload(): Record<string, unknown> {
    return {
      user: { id: '22222222-2222-4222-8222-222222222222', email: this.email },
      workspaces: [
        {
          workspaceId: this.workspaceId,
          slug: 'studio',
          name: 'Studio',
          role: 'editor',
          aiEnabled: false,
        },
      ],
    }
  }
}

function normaliseHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers === undefined) {
    return out
  }
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers)
  for (const [key, value] of entries) {
    out[key.toLowerCase()] = String(value)
  }
  return out
}

async function bodyToBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (body === null || body === undefined) {
    return null
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body)
  }
  if (body instanceof Uint8Array) {
    // Copied, so a later mutation of the caller's buffer cannot retroactively
    // change what this log says was sent.
    const copy = new Uint8Array(body.byteLength)
    copy.set(body)
    return copy
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body.slice(0))
  }
  return new Uint8Array(await new Response(body).arrayBuffer())
}

function decodeJson(bytes: Uint8Array | null): Record<string, unknown> {
  if (bytes === null) {
    return {}
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** A `.tela` stand-in: JSON whose `content` decides the revision and whose `title` does not. */
export function fakeBundle(title: string, content: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ title, content }))
}
