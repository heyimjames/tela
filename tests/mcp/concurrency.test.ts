/**
 * Two *separate* MCP processes editing one source.
 *
 * The existing suite covers the in-process case: a Codex session and a Claude
 * session connected to one server share a session and a per-path lock, so the
 * second writer is refused by the session-revision gate. That is the easy half,
 * and it proves nothing about the hard half.
 *
 * The hard half is two processes — a Codex host and a Claude host each launching
 * their own `node ./bin/tela-mcp.mjs`. They share no memory, so they share no
 * lock and no session counter. The only thing standing between them and a lost
 * update is the **disk revision gate**: save re-reads the file and refuses if
 * what is there is not what the session was opened from.
 *
 * The scenario below is the exact lost-update race, staged deterministically:
 * both processes open the same design at the same revision, both mutate, and
 * both save. Without the gate the second save silently discards the first
 * process's work and nobody finds out until someone notices their edit is gone.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'

import { REPOSITORY_ROOT } from './harness'

const LAUNCHER = join(REPOSITORY_ROOT, 'bin/tela-mcp.mjs')
const DESIGN = 'shared/campaign.tela'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tela-concurrency-'))
  await stat(join(REPOSITORY_ROOT, 'dist/mcp/tela-mcp.mjs')).catch(() => {
    throw new Error('dist/mcp/tela-mcp.mjs is missing — run `npm run build` before this suite')
  })
}, 30_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * A whole separate server process, exactly as a host launches it.
 *
 * The point of spawning rather than building a second in-process server is that
 * an in-process pair would share this module's session map and lock table — the
 * very things two real hosts do not share.
 */
async function spawnHost(name: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [LAUNCHER],
    env: { ...getDefaultEnvironment(), TELA_APPROVED_ROOT: root, TELA_LOG_LEVEL: 'error' },
    stderr: 'pipe',
  })
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(transport)
  return { client, close: () => client.close() }
}

async function callTool<T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('\n')
  if (result.isError) throw new Error(`${name} failed: ${text}`)
  return result.structuredContent as T
}

async function callExpectingError(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ text?: string }>).map((block) => block.text ?? '').join('\n')
  if (!result.isError) throw new Error(`${name} unexpectedly succeeded: ${text}`)
  return text
}

interface Session {
  session: { session_revision: number; disk_revision: string }
}

describe('two MCP processes editing one source', () => {
  it('refuses the second save because the file changed underneath it', async () => {
    const codex = await spawnHost('codex-host')
    const claude = await spawnHost('claude-host')
    try {
      await callTool(codex.client, 'tela_create_design', { design: DESIGN, name: 'Shared campaign' })

      // Both hosts open the same file and observe the same disk revision. This
      // is the ordinary situation, not a contrived one: two agents told to work
      // on the same campaign will do exactly this.
      const openedByCodex = await callTool<Session>(codex.client, 'tela_open_design', { design: DESIGN })
      const openedByClaude = await callTool<Session>(claude.client, 'tela_open_design', { design: DESIGN })
      expect(openedByCodex.session.disk_revision).toBe(openedByClaude.session.disk_revision)
      const sharedDiskRevision = openedByCodex.session.disk_revision

      const codexEdit = await callTool<Session>(codex.client, 'tela_add_page', {
        design: DESIGN,
        name: 'Added by Codex',
        expected_session_revision: openedByCodex.session.session_revision,
      })
      const claudeEdit = await callTool<Session>(claude.client, 'tela_add_page', {
        design: DESIGN,
        name: 'Added by Claude',
        expected_session_revision: openedByClaude.session.session_revision,
      })

      // First save wins and commits.
      const saved = await callTool<{ disk_revision: string }>(codex.client, 'tela_save_design', {
        design: DESIGN,
        expected_session_revision: codexEdit.session.session_revision,
        expected_disk_revision: sharedDiskRevision,
      })
      expect(saved.disk_revision).not.toBe(sharedDiskRevision)

      // Second save is refused. Its session revision is perfectly valid — it has
      // no idea anything happened, because nothing happened *in its process*.
      // Only the disk gate can catch this.
      const message = await callExpectingError(claude.client, 'tela_save_design', {
        design: DESIGN,
        expected_session_revision: claudeEdit.session.session_revision,
        expected_disk_revision: sharedDiskRevision,
      })
      expect(message).toMatch(/changed outside this session|revision/i)
      expect(message).toMatch(/tela_close_design|reopen/i)

      // The committed file is the first writer's, whole. A lost update would
      // show up here as Claude's page present and Codex's gone.
      const reader = await spawnHost('reader-host')
      try {
        await callTool(reader.client, 'tela_open_design', { design: DESIGN })
        const summary = await callTool<{ pages: Array<{ name: string }> }>(reader.client, 'tela_get_design_summary', { design: DESIGN })
        const names = summary.pages.map((page) => page.name)
        expect(names).toContain('Added by Codex')
        expect(names).not.toContain('Added by Claude')
      } finally {
        await reader.close()
      }
    } finally {
      await codex.close()
      await claude.close()
    }
  }, 60_000)

  /**
   * The recovery path the refusal advertises has to actually work, or the error
   * message is just a polite dead end.
   */
  it('lets the refused host recover by reopening and reapplying', async () => {
    const design = 'shared/recover.tela'
    const first = await spawnHost('first-host')
    const second = await spawnHost('second-host')
    try {
      await callTool(first.client, 'tela_create_design', { design, name: 'Recoverable' })
      const openedFirst = await callTool<Session>(first.client, 'tela_open_design', { design })
      const openedSecond = await callTool<Session>(second.client, 'tela_open_design', { design })

      const edited = await callTool<Session>(first.client, 'tela_add_page', {
        design,
        name: 'First',
        expected_session_revision: openedFirst.session.session_revision,
      })
      await callTool(first.client, 'tela_save_design', {
        design,
        expected_session_revision: edited.session.session_revision,
        expected_disk_revision: openedFirst.session.disk_revision,
      })

      const staleEdit = await callTool<Session>(second.client, 'tela_add_page', {
        design,
        name: 'Second',
        expected_session_revision: openedSecond.session.session_revision,
      })
      await callExpectingError(second.client, 'tela_save_design', {
        design,
        expected_session_revision: staleEdit.session.session_revision,
        expected_disk_revision: openedSecond.session.disk_revision,
      })

      // Follow the advice the error gave: close discarding, reopen, reapply.
      await callTool(second.client, 'tela_close_design', { design, discard_changes: true })
      const reopened = await callTool<Session>(second.client, 'tela_open_design', { design })
      const reapplied = await callTool<Session>(second.client, 'tela_add_page', {
        design,
        name: 'Second',
        expected_session_revision: reopened.session.session_revision,
      })
      await callTool(second.client, 'tela_save_design', {
        design,
        expected_session_revision: reapplied.session.session_revision,
        expected_disk_revision: reopened.session.disk_revision,
      })

      const summary = await callTool<{ pages: Array<{ name: string }> }>(second.client, 'tela_get_design_summary', { design })
      const names = summary.pages.map((page) => page.name)
      // Both edits survive, because the second was reapplied on top of the first
      // rather than over it.
      expect(names).toContain('First')
      expect(names).toContain('Second')
    } finally {
      await first.close()
      await second.close()
    }
  }, 60_000)
})
