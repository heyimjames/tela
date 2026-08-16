/**
 * The private loopback application server.
 *
 * This serves the **bundled production Pyrito Design build** to the private browser. It
 * is not a development server: there is no Vite, no watcher, and no module
 * graph at runtime — just static bytes from a directory produced at build time.
 *
 * Everything about its exposure is deliberately narrow:
 *
 *  - bound to `127.0.0.1` on an **OS-assigned port**, so it is unreachable off
 *    the machine and does not squat a predictable one;
 *  - every path is prefixed with a **per-process random token**, so another
 *    local process that guesses the port still cannot guess the URL;
 *  - a **matching header** is required as well, because a path token can leak
 *    through a referrer or a log line while a request header cannot be forged
 *    by a navigation from another origin;
 *  - **Host and Origin are checked** on every request, closing DNS-rebinding
 *    (a hostile page resolving its own name to 127.0.0.1);
 *  - a strict **CSP** with no external origins at all, matching the runtime's
 *    "no outbound requests" contract at the browser layer as well as the Node
 *    one.
 *
 * The build is served under the token prefix, which is why the bridge build
 * uses a relative base — absolute `/assets/...` URLs would escape the prefix.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { toolError } from '../errors'
import { log } from '../logging'

export const TOKEN_HEADER = 'x-tela-bridge-token'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
}

/**
 * No `connect-src` beyond `'self'`, no remote script or style origin, and
 * `frame-ancestors 'none'`. `'unsafe-inline'` is present for styles only
 * because the app's styling is injected at runtime; scripts get no such
 * exception.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export interface BridgeServer {
  origin: string
  /** Fully-qualified URL of the app's entry document, token prefix included. */
  appUrl: string
  token: string
  port: number
  close(): Promise<void>
}

/** Where the bridge build lands. Overridable so a test can serve a fixture directory. */
export function bridgeRoot(): string {
  const configured = process.env.TELA_BRIDGE_ROOT
  if (configured && configured.trim()) return resolve(configured.trim())
  // `dist-bridge` sits beside the compiled server output; resolve from this
  // module rather than `process.cwd()`, which is the client's directory and has
  // nothing to do with where the payload was installed.
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..', 'dist-bridge')
}

export async function startBridgeServer(): Promise<BridgeServer> {
  const root = bridgeRoot()
  try {
    const info = await stat(join(root, 'index.html'))
    if (!info.isFile()) throw new Error('not a file')
  } catch {
    throw toolError(
      'bridge_failed',
      'the bundled Pyrito Design application build is missing',
      'run `npm run build:bridge` in the tela-design payload to produce dist-bridge/, or set TELA_BRIDGE_ROOT to an existing build; the bridge never falls back to a development server',
    )
  }

  const token = randomBytes(24).toString('base64url')
  const server = createServer()

  server.on('request', (request, response) => {
    handle(request, response, root, token).catch(() => {
      respondEmpty(response, 500)
    })
  })

  const port = await listen(server)
  const origin = `http://127.0.0.1:${port}`

  return {
    origin,
    token,
    port,
    appUrl: `${origin}/${token}/index.html`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections?.()
        server.close(() => resolveClose())
      }),
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) resolveListen(address.port)
      else rejectListen(new Error('the bridge server did not report a port'))
    })
  })
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function hostAllowed(header: string | undefined, port: number): boolean {
  if (!header) return false
  const withoutPort = header.replace(/:\d+$/, '')
  if (!LOOPBACK_HOSTS.has(withoutPort)) return false
  const declared = /:(\d+)$/.exec(header)
  // A Host naming a different port is a rebinding attempt, not a typo.
  return declared ? Number(declared[1]) === port : false
}

async function handle(request: IncomingMessage, response: ServerResponse, root: string, token: string): Promise<void> {
  const port = (request.socket.localPort ?? 0) as number

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    respondEmpty(response, 405)
    return
  }
  if (!hostAllowed(request.headers.host, port)) {
    log({ level: 'warn', traceId: 'bridge', event: 'bridge.host_rejected', detail: 'host header did not match the loopback origin' })
    respondEmpty(response, 403)
    return
  }
  const origin = request.headers.origin
  if (origin && origin !== `http://127.0.0.1:${port}`) {
    log({ level: 'warn', traceId: 'bridge', event: 'bridge.origin_rejected', detail: 'origin header did not match the loopback origin' })
    respondEmpty(response, 403)
    return
  }
  if (request.headers[TOKEN_HEADER] !== token) {
    respondEmpty(response, 403)
    return
  }

  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== token) {
    respondEmpty(response, 404)
    return
  }

  const requested = segments.slice(1)
  const relative = requested.length === 0 ? 'index.html' : requested.join('/')
  // Normalize *then* re-check containment: `%2e%2e` decodes to `..` and the
  // split above would not have caught it.
  const target = normalize(join(root, relative))
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (target !== root && !target.startsWith(rootWithSep)) {
    respondEmpty(response, 403)
    return
  }

  let info
  try {
    info = await stat(target)
  } catch {
    respondEmpty(response, 404)
    return
  }
  if (info.isDirectory()) {
    respondEmpty(response, 404)
    return
  }

  const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream'
  response.writeHead(200, {
    'content-type': type,
    'content-length': String(info.size),
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  createReadStream(target).pipe(response)
}

function respondEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': '0',
    'content-security-policy': CSP,
    'referrer-policy': 'no-referrer',
  })
  response.end()
}
