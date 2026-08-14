/**
 * Host-neutral session plumbing for the evaluations.
 *
 * "Host-neutral" is the requirement that shapes this file. Anthropic's
 * mcp-builder harness is supplemental evidence — it tells you how the server
 * behaves when Claude drives it. It cannot tell you whether the *protocol
 * surface* is correct, because a harness bug and a server bug look identical
 * from inside the harness.
 *
 * So the evaluations here spawn the compiled artifact exactly as a host manifest
 * does — `node ./bin/tela-mcp.mjs` — and drive it with the official MCP client
 * SDK over stdio. No Claude, no Codex, no skill, no test framework in the
 * transport path. Whatever passes here passes for any conformant host, and a
 * failure is attributable to the server rather than to whoever was driving it.
 */

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EVALUATIONS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPOSITORY_ROOT = resolve(EVALUATIONS_ROOT, '..')
export const LAUNCHER = join(REPOSITORY_ROOT, 'bin/tela-mcp.mjs')
export const FIXTURE_DIR = join(EVALUATIONS_ROOT, 'fixtures')

/**
 * A disposable approved root seeded with a *copy* of the fixtures.
 *
 * A copy, not the fixtures themselves: the questions are read-only, and copying
 * is how that claim gets checked rather than asserted. The runner re-hashes the
 * committed fixtures afterwards, so a question that mutated anything shows up as
 * a digest change against files nothing should have touched.
 */
export async function makeSeededRoot({ seed = true } = {}) {
  const { realpath } = await import('node:fs/promises')
  // `realpath`: on macOS `mkdtemp` hands back a path through the `/var` symlink,
  // and the server's no-follow path policy correctly refuses it.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tela-eval-')))
  if (seed) await cp(join(FIXTURE_DIR, 'designs'), join(root, 'campaigns'), { recursive: true })
  return root
}

export async function connect(root, { logLevel = 'error' } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [LAUNCHER],
    // The SDK's own platform-aware default environment, plus this run's root.
    // Hand-writing the list is the classic way to ship something that works on
    // POSIX and cannot start `node.exe` on Windows.
    env: { ...getDefaultEnvironment(), TELA_APPROVED_ROOT: root, TELA_LOG_LEVEL: logLevel },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'tela-evaluations', version: '1.0.0' })
  await client.connect(transport)
  return {
    client,
    close: async () => {
      await client.close().catch(() => {})
      await rm(root, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/** Call a tool, returning its structured content. Throws with the server's own text on error. */
export async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content ?? []).map((block) => block.text ?? '').join('\n')
  if (result.isError) throw new Error(`${name} failed: ${text}`)
  return result.structuredContent
}
