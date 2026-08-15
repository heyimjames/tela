/**
 * A stub of the hosted v1 API, for the workspace-mode cookie gate (CLI-538).
 *
 * ## Why a fixture server and not the real backend
 *
 * The property under test is the *browser's* half of session handling: that a
 * `Set-Cookie` from login is stored, that `credentials: 'include'` actually puts it on
 * the next authenticated call, and that logout removes it. None of that is a claim
 * about `hivemind-design-server` — CLI-517 proved the controller side, and this repo
 * is the app. Depending on the real server would make this gate need a database, a
 * migration and a seeded user to answer a question about cookie plumbing, and its red
 * would then mean six different things.
 *
 * It is also not `page.route` interception. That intercepts inside the browser, so a
 * request the app never sent and a request the interceptor answered look identical —
 * and the whole question here is what the browser put on the wire. A real socket,
 * with a real server writing down what arrived, is the only observer that can tell
 * "the cookie was sent" from "nothing was watching".
 *
 * ## Why it also serves the app
 *
 * `src/workspace/endpoint.ts`: the deployment is same-origin, so the session cookie
 * is first-party and needs no `SameSite=None`. Serving the built app and the API from
 * one origin reproduces that. A separate API origin would test a configuration the
 * product does not ship.
 *
 * ## The request log is the evidence
 *
 * Every API request is recorded with whether a session cookie arrived, readable at
 * `/__stub__/requests`. The spec asserts against that log — including that at least
 * one request arrived *without* the cookie — so "cookies are being sent" cannot pass
 * on a log that never contained anything.
 *
 * No credential here is real, and nothing is persisted: the session token is minted
 * per process and lives in memory.
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const PORT = Number(process.env.STUB_PORT ?? 4332)
const ROOT = path.resolve(process.cwd(), process.env.STUB_ROOT ?? 'dist-workspace-probe')

/** The cookie name the API contract uses (`vendor/design-api-client/src/client.ts`). */
const COOKIE_NAME = 'hmd_session'

/** The one account this stub knows. Not a credential: it exists only in this process. */
const ACCOUNT = { email: 'gate@example.invalid', password: 'stub-password-not-a-secret' }
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_PAYLOAD = {
  user: { id: '00000000-0000-4000-8000-0000000000a1', email: ACCOUNT.email },
  workspaces: [
    {
      workspaceId: WORKSPACE_ID,
      slug: 'gate-workspace',
      name: 'Gate Workspace',
      role: 'owner',
      aiEnabled: false,
    },
  ],
}

/** Minted at login, cleared at logout. A session that is `null` authenticates nothing. */
let liveSession = null

/** Every API request that arrived, in order. Read by the spec at `/__stub__/requests`. */
const requestLog = []

function sessionFrom(request) {
  const header = request.headers.cookie
  if (typeof header !== 'string') return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE_NAME) return rest.join('=')
  }
  return null
}

function json(response, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  })
  response.end(payload)
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

async function serveStatic(pathname, response) {
  // Resolved and then re-checked against the root: a `..` in the URL must not be able
  // to read outside the build directory, stub or not.
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const resolved = path.resolve(ROOT, relative)
  const target = resolved.startsWith(ROOT + path.sep) || resolved === ROOT ? resolved : path.join(ROOT, 'index.html')

  let file = target
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
  } catch {
    // Single-page fallback, matching how the app is served in production.
    file = path.join(ROOT, 'index.html')
  }

  try {
    const bytes = await readFile(file)
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': bytes.byteLength,
    })
    response.end(bytes)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const pathname = url.pathname

  if (pathname === '/__stub__/health') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  if (pathname === '/__stub__/requests') {
    // Not itself logged: the observer must not appear in its own record.
    json(response, 200, { requests: requestLog })
    return
  }

  if (pathname.startsWith('/v1/')) {
    const cookie = sessionFrom(request)
    requestLog.push({
      method: request.method ?? 'GET',
      path: pathname,
      cookiePresent: cookie !== null,
      // Whether the cookie that arrived is the live one. A stale cookie being sent
      // after logout is a different failure from no cookie at all, and the spec must
      // be able to tell them apart.
      cookieIsLiveSession: cookie !== null && liveSession !== null && cookie === liveSession,
    })

    if (pathname === '/v1/auth/login' && request.method === 'POST') {
      const body = await readJsonBody(request)
      if (body?.email !== ACCOUNT.email || body?.password !== ACCOUNT.password) {
        json(response, 401, { code: 'invalid_credentials', message: 'Email or password is incorrect.' })
        return
      }
      liveSession = randomUUID()
      json(response, 200, SESSION_PAYLOAD, {
        // No `Secure`: the gate runs over http on loopback. Everything else matches
        // what the contract describes — HttpOnly, path-wide, first-party.
        'set-cookie': `${COOKIE_NAME}=${liveSession}; Path=/; HttpOnly; SameSite=Lax`,
      })
      return
    }

    if (pathname === '/v1/auth/logout' && request.method === 'POST') {
      liveSession = null
      response.writeHead(204, {
        'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      })
      response.end()
      return
    }

    // Everything below this line is authenticated, and the check is the real one: the
    // cookie must be present *and* be the session this process minted.
    if (cookie === null || cookie !== liveSession) {
      json(response, 401, { code: 'unauthenticated', message: 'sign in' })
      return
    }

    if (pathname === '/v1/auth/me' && request.method === 'GET') {
      json(response, 200, SESSION_PAYLOAD)
      return
    }

    if (pathname === `/v1/workspaces/${WORKSPACE_ID}/documents` && request.method === 'GET') {
      json(response, 200, { documents: [] })
      return
    }

    json(response, 404, { code: 'not_found', message: `stub has no route for ${request.method} ${pathname}` })
    return
  }

  await serveStatic(pathname, response)
})

// Fail loudly rather than serving 404s for every asset: a stub that starts against an
// empty directory would leave the spec looking at a blank page and guessing why.
try {
  await stat(path.join(ROOT, 'index.html'))
} catch {
  console.error(`stub-server: no index.html under ${ROOT} — build the workspace-mode app first`)
  process.exit(1)
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub-server: serving ${ROOT} and the v1 stub on http://127.0.0.1:${PORT}`)
})
