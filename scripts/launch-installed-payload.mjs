#!/usr/bin/env node
/**
 * Launch an *installed* payload and prove it serves its MCP surface (CLI-520).
 *
 * The distinction this script exists for: `npm test` runs the source tree, and a
 * green source-tree suite is not evidence that the shipped artifact starts on
 * another operating system. v0.3 r2 shipped a bare-path dynamic `import()` that
 * worked on every developer machine and broke every Windows host while all local
 * runs were green. So the cross-OS job copies the built artifact out of the
 * repository, installs its own lockfile the way a consumer would, and runs
 * *this* — which spawns `bin/tela-mcp.mjs` exactly as a host manifest does and
 * talks JSON-RPC to it over stdio.
 *
 * Assertions are absolute, never "the two responses match": two identical
 * failures satisfy a comparison (CLI-514). The tool count is pinned so a payload
 * that starts but serves a truncated surface fails here rather than in front of
 * an operator.
 *
 * Usage:
 *   node scripts/launch-installed-payload.mjs <installed-payload-dir> [--expect-tools <n>]
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const payloadDir = resolve(argv[0] ?? '')
const expectIndex = argv.indexOf('--expect-tools')
const expectedTools = expectIndex === -1 ? 48 : Number(argv[expectIndex + 1])

if (!argv[0]) throw new Error('usage: launch-installed-payload.mjs <installed-payload-dir> [--expect-tools <n>]')
const launcher = join(payloadDir, 'bin/tela-mcp.mjs')
if (!existsSync(launcher)) throw new Error(`no launcher at ${launcher}; is this an installed payload?`)
if (!existsSync(join(payloadDir, 'node_modules'))) {
  throw new Error(`${payloadDir} has no node_modules; install the payload's own lockfile first, or this proves nothing about a consumer install`)
}

const log = (message) => process.stdout.write(`payload-launch: ${message}\n`)
log(`launching ${launcher} (node ${process.version} on ${process.platform})`)

const child = spawn(process.execPath, [launcher], {
  cwd: payloadDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  // A deliberately bare environment: the payload must not depend on anything the
  // developer's shell happens to export.
  env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, SystemRoot: process.env.SystemRoot },
})

let stdout = ''
let stderr = ''
const pending = new Map()
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdout += chunk
  let newline
  while ((newline = stdout.indexOf('\n')) !== -1) {
    const line = stdout.slice(0, newline).trim()
    stdout = stdout.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line)
    const resolver = pending.get(message.id)
    if (resolver) {
      pending.delete(message.id)
      resolver(message)
    }
  }
})
child.stderr.on('data', (chunk) => {
  stderr += chunk
})

const timeout = setTimeout(() => {
  process.stderr.write(`payload-launch: TIMED OUT after 60s\n--- stderr ---\n${stderr}\n`)
  child.kill('SIGKILL')
  process.exit(1)
}, 60_000)

function request(id, method, params) {
  return new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, resolveRequest)
    child.on('exit', (code) => rejectRequest(new Error(`the server exited (code ${code}) before answering ${method}\n--- stderr ---\n${stderr}`)))
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

try {
  const initialize = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'cli-520-consumer-probe', version: '1' },
  })
  assert(initialize.result?.serverInfo?.name === 'tela-design-mcp-server', `serverInfo.name was ${JSON.stringify(initialize.result?.serverInfo?.name)}`)
  log(`initialize ok: ${initialize.result.serverInfo.name} ${initialize.result.serverInfo.version}, protocol ${initialize.result.protocolVersion}`)

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

  const tools = await request(2, 'tools/list', {})
  const count = tools.result?.tools?.length ?? 0
  assert(count === expectedTools, `tools/list returned ${count} tools, expected ${expectedTools}`)
  log(`tools/list ok: ${count} tools`)

  const resources = await request(3, 'resources/list', {})
  log(`resources/list ok: ${resources.result?.resources?.length ?? 0} resources`)

  // A real call, not just discovery: a server can answer `tools/list` from a
  // static manifest while being unable to execute anything.
  const status = await request(4, 'tools/call', { name: 'tela_get_status', arguments: {} })
  const serverName = status.result?.structuredContent?.server_name
  assert(serverName === 'tela-design-mcp-server', `tela_get_status returned server_name ${JSON.stringify(serverName)}`)
  log(`tools/call tela_get_status ok: server_name=${serverName}`)

  assert(stderr.includes('"event":"serving"'), 'the server never logged its "serving" event to stderr')
  log('stderr carries the serving event; stdout carried only JSON-RPC frames')
  log('PASS: the installed payload starts and serves its MCP surface')
} catch (error) {
  process.stderr.write(`payload-launch: FAILED — ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  child.kill('SIGTERM')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
