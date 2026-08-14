/**
 * Spawned compiled-stdio tests.
 *
 * These launch the **built artifact** — `node ./bin/tela-mcp.mjs` — as a real
 * child process. That is the point: an in-process link cannot catch a launcher
 * that needs a TypeScript loader, a stray `console.log` corrupting the framing,
 * or a process that refuses to exit when its client goes away. Every one of
 * those is invisible until something spawns the thing for real.
 *
 * Both protocol openings are covered: the legacy `initialize` handshake and the
 * modern `server/discover` negotiation, from the same factory.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'

import { REPOSITORY_ROOT } from './harness'

const LAUNCHER = join(REPOSITORY_ROOT, 'bin/tela-mcp.mjs')
const COMPILED = join(REPOSITORY_ROOT, 'dist/mcp/tela-mcp.mjs')

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tela-stdio-'))
  // The suite runs against the build, so a missing build is a failed
  // precondition rather than a mysterious spawn error 30 lines later.
  await stat(COMPILED).catch(() => {
    throw new Error('dist/mcp/tela-mcp.mjs is missing — run `npm run build` before this suite')
  })
}, 30_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Environment for the spawned server.
 *
 * Built on the SDK's own `getDefaultEnvironment()`, which is platform-aware,
 * rather than a hand-written list. A hand-written allowlist is the trap here: on
 * POSIX, `PATH` plus `HOME` is enough and everything passes, so the omission is
 * invisible until it reaches Windows — where `node.exe` will not start without
 * `SYSTEMROOT` (its crypto/RNG and DLL loading need it) and `TEMP`. The child
 * then dies before it can emit a single frame, which surfaces to the client as
 * "Connection closed" a hundred milliseconds in, and to a raw `spawn` test as a
 * read that never completes.
 *
 * Using the SDK's list also means these tests inherit exactly what a real MCP
 * client gives a server, so the environment under test is the environment in
 * production rather than an approximation of it.
 */
function childEnvironment(): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    TELA_APPROVED_ROOT: root,
    TELA_LOG_LEVEL: 'debug',
  }
}

/**
 * Wait until `stream` has produced at least `count` non-blank lines, or the
 * deadline passes.
 *
 * Replaces a fixed sleep. A sleep long enough for a cold Node start on a busy
 * Windows runner is wastefully long on macOS, and a sleep short enough to feel
 * quick on macOS is a flake on Windows. Waiting for the actual evidence is both
 * faster and deterministic.
 */
async function collectLines(stream: NodeJS.ReadableStream, count: number, timeoutMs = 20_000): Promise<string[]> {
  const chunks: Buffer[] = []
  stream.on('data', (chunk: Buffer) => chunks.push(chunk))
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter((line) => line.trim().length > 0)
    if (lines.length >= count || Date.now() > deadline) return lines
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

interface Connected {
  client: Client
  close: () => Promise<void>
}

async function connect(options: { modern: boolean }): Promise<Connected> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [LAUNCHER],
    env: childEnvironment(),
    stderr: 'pipe',
  })
  const client = new Client(
    { name: 'tela-stdio-test', version: '1.0.0' },
    options.modern ? { versionNegotiation: { mode: 'auto' } } : {},
  )
  await client.connect(transport)
  return { client, close: () => client.close() }
}

describe('compiled artifact', () => {
  it('hands the ESM loader a file:// URL rather than a bare path', async () => {
    // This guards a defect that is invisible on the platform it is developed on.
    // A dynamic import specifier is a URL; on Windows an absolute path starts
    // with a drive letter, so `import("D:\\...")` is read as the scheme `d:` and
    // rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME before any of our code runs.
    // On POSIX the bare path happens to work, so the server starts fine on every
    // developer machine and fails to launch on every Windows host.
    //
    // Asserting on the launcher's source is unusual, and it is deliberate: the
    // behaviour itself cannot be observed from macOS, so without this the only
    // signal is a red Windows run.
    const source = await readFile(LAUNCHER, 'utf8')
    expect(source).toMatch(/pathToFileURL\(/)
    expect(source, 'the launcher passes a bare filesystem path to import()').not.toMatch(/await import\(\s*compiled\s*\)/)
  })

  it('runs under plain node with no TypeScript loader on the command line', async () => {
    // No tsx, no ts-node, no npx, no --loader, no --experimental flags.
    const child = spawn(process.execPath, [LAUNCHER], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n',
    )
    const [chunk] = (await once(child.stdout, 'data')) as [Buffer]
    const line = chunk.toString('utf8').split('\n')[0]
    const response = JSON.parse(line)
    expect(response.jsonrpc).toBe('2.0')
    expect(response.result.serverInfo.name).toBe('tela-design-mcp-server')

    child.kill('SIGTERM')
    await once(child, 'exit')
    // Diagnostics went to stderr, which is where they belong.
    expect(Buffer.concat(stderr).toString('utf8')).toContain('"event":"serving"')
  }, 30_000)
})

describe('legacy initialization', () => {
  it('completes the 2025-era handshake and serves the full surface', async () => {
    const connection = await connect({ modern: false })
    try {
      const { tools } = await connection.client.listTools()
      expect(tools).toHaveLength(48)
      const { resources } = await connection.client.listResources()
      expect(resources).toHaveLength(5)
      const status = await connection.client.callTool({ name: 'tela_get_status', arguments: {} })
      expect((status.structuredContent as { server_name: string }).server_name).toBe('tela-design-mcp-server')
    } finally {
      await connection.close()
    }
  }, 30_000)
})

describe('modern discovery', () => {
  it('negotiates via discovery and serves the same surface from the same factory', async () => {
    const connection = await connect({ modern: true })
    try {
      const { tools } = await connection.client.listTools()
      expect(tools).toHaveLength(48)
      const names = tools.map((tool) => tool.name).sort()

      // The two eras must not drift: whatever the opening, the tool list is the
      // same object graph built by one factory.
      const legacy = await connect({ modern: false })
      try {
        const legacyTools = await legacy.client.listTools()
        expect(legacyTools.tools.map((tool) => tool.name).sort()).toEqual(names)
      } finally {
        await legacy.close()
      }

      const resource = await connection.client.readResource({ uri: 'tela://formats' })
      expect(() => JSON.parse((resource.contents as Array<{ text: string }>)[0].text)).not.toThrow()
    } finally {
      await connection.close()
    }
  }, 45_000)
})

describe('stdout purity', () => {
  it('writes nothing but JSON-RPC frames to stdout across a full session', async () => {
    const child = spawn(process.execPath, [LAUNCHER], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    const collected = collectLines(child.stdout, 5)

    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    send({ jsonrpc: '2.0', id: 3, method: 'resources/list' })
    // A failing call too: an error path that printed to stdout would be just as
    // fatal as a successful one, and is likelier to be overlooked.
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tela_open_design', arguments: { design: 'missing.tela' } } })
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'tela_get_status', arguments: {} } })

    const lines = await collected
    child.kill()
    await once(child, 'exit')

    expect(lines.length).toBeGreaterThanOrEqual(5)
    for (const line of lines) {
      const parsed = JSON.parse(line) as { jsonrpc?: string }
      expect(parsed.jsonrpc, `stdout carried a non-JSON-RPC line: ${line.slice(0, 120)}`).toBe('2.0')
    }
  }, 30_000)

  it('keeps stderr diagnostics structured and free of absolute paths', async () => {
    const child = spawn(process.execPath, [LAUNCHER], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    // "serving", then the tool call's own warn record.
    const collected = collectLines(child.stderr, 2)

    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tela_open_design', arguments: { design: 'deeply/nested/missing.tela' } } })

    const lines = await collected
    child.kill()
    await once(child, 'exit')

    const text = lines.join('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const record = JSON.parse(line) as { ts: string; level: string; traceId: string; event: string }
      expect(record.ts).toBeTruthy()
      expect(record.level).toBeTruthy()
      expect(record.traceId).toBeTruthy()
      expect(record.event).toBeTruthy()
    }
    expect(text).not.toContain(root)
    expect(text).not.toMatch(/"detail":"[^"]*\/Users\//)
  }, 30_000)
})

describe('shutdown', () => {
  it('exits when stdin reaches EOF', async () => {
    const child = spawn(process.execPath, [LAUNCHER], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    child.stderr.resume()
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n',
    )
    await once(child.stdout, 'data')

    child.stdin.end()
    const [code] = (await once(child, 'exit')) as [number | null]
    expect(code).toBe(0)
  }, 30_000)

  it('terminates when signalled', async () => {
    const child = spawn(process.execPath, [LAUNCHER], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    child.stderr.resume()
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n',
    )
    await once(child.stdout, 'data')

    child.kill('SIGTERM')
    const [code, signal] = (await once(child, 'exit')) as [number | null, string | null]

    if (process.platform === 'win32') {
      // Windows has no POSIX signals. `child.kill('SIGTERM')` calls
      // TerminateProcess, so the server's SIGTERM handler never runs and the
      // exit is abrupt by definition — asserting a graceful 0 here would be
      // asserting something the platform cannot do. What must hold is that the
      // process actually dies. Graceful shutdown on Windows is the stdin-EOF
      // path, which the test above covers and which is what a real client uses.
      expect(code !== null || signal !== null).toBe(true)
    } else {
      expect(code === 0 || signal === 'SIGTERM').toBe(true)
    }
  }, 30_000)

  it('refuses to launch with a helpful message when the build is missing', async () => {
    // The launcher resolves dist/ relative to its own location, so a *copy* in a
    // directory with no dist/ exercises the real guard. Spawning a path that
    // simply does not exist would only prove Node reports a missing module.
    const empty = await mkdtemp(join(tmpdir(), 'tela-nodist-'))
    try {
      const copied = join(empty, 'tela-mcp.mjs')
      await copyFile(LAUNCHER, copied)

      const child = spawn(process.execPath, [copied], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      const [code] = (await once(child, 'exit')) as [number | null]

      expect(code).toBe(1)
      expect(Buffer.concat(stderr).toString('utf8')).toMatch(/npm run build/)
      // The complaint goes to stderr. On stdout it would corrupt the very first
      // frame the client tries to parse.
      expect(Buffer.concat(stdout).toString('utf8')).toBe('')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('end-to-end over stdio', () => {
  it('creates, edits, saves, and reopens a design through the spawned process', async () => {
    const connection = await connect({ modern: false })
    try {
      const created = await connection.client.callTool({
        name: 'tela_create_design',
        arguments: { design: 'stdio/roundtrip.tela', name: 'Round trip' },
      })
      expect(created.isError).toBeFalsy()
      const frameId = (created.structuredContent as { frame_id: string }).frame_id

      const added = await connection.client.callTool({
        name: 'tela_add_layers',
        arguments: {
          design: 'stdio/roundtrip.tela',
          frame_id: frameId,
          expected_session_revision: 0,
          layers: [{ type: 'text', content: 'Over stdio', fontSize: 40 }],
        },
      })
      expect(added.isError).toBeFalsy()

      const summary = await connection.client.callTool({ name: 'tela_get_design_summary', arguments: { design: 'stdio/roundtrip.tela' } })
      const { session_revision: revision, disk_revision: disk } = summary.structuredContent as { session_revision: number; disk_revision: string }

      const saved = await connection.client.callTool({
        name: 'tela_save_design',
        arguments: { design: 'stdio/roundtrip.tela', expected_session_revision: revision, expected_disk_revision: disk },
      })
      expect(saved.isError).toBeFalsy()
      expect((saved.structuredContent as { bytes_written: number }).bytes_written).toBeGreaterThan(0)

      await connection.client.callTool({ name: 'tela_close_design', arguments: { design: 'stdio/roundtrip.tela' } })
      const reopened = await connection.client.callTool({ name: 'tela_open_design', arguments: { design: 'stdio/roundtrip.tela' } })
      expect(reopened.isError).toBeFalsy()

      const scene = await connection.client.callTool({ name: 'tela_get_scene', arguments: { design: 'stdio/roundtrip.tela', frame_id: frameId } })
      expect((scene.structuredContent as { layers: Array<{ content?: string }> }).layers[0].content).toBe('Over stdio')
    } finally {
      await connection.close()
    }
  }, 45_000)

  it('validates tool output against the advertised schema on the client side', async () => {
    // The SDK client validates `structuredContent` against each tool's declared
    // outputSchema. A handler that drifted from its own schema fails here.
    const connection = await connect({ modern: false })
    try {
      for (const name of ['tela_get_status', 'tela_get_capabilities', 'tela_list_designs', 'tela_list_templates', 'tela_list_layouts']) {
        const result = await connection.client.callTool({ name, arguments: {} })
        expect(result.isError, `${name} returned an error`).toBeFalsy()
        expect(result.structuredContent, `${name} returned no structured content`).toBeTruthy()
      }
    } finally {
      await connection.close()
    }
  }, 30_000)
})
