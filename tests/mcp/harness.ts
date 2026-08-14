/**
 * Test harness.
 *
 * `connectInProcess` links a real `Client` to a real `buildServer()` over the
 * SDK's in-memory transport — the official client/server contract path. It is
 * not a mock: the same schema validation, the same annotations, and the same
 * error projection run as over a pipe. The spawned-stdio tests cover what an
 * in-process link cannot (framing, stdout purity, process shutdown).
 */

import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { buildServer } from '../../src/mcp/server'
import { resetSessions } from '../../src/mcp/sessions'

export const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')

export interface Harness {
  client: Client
  root: string
  close: () => Promise<void>
}

/**
 * A fresh approved root per test.
 *
 * `mkdtemp` under the OS temp dir can hand back a symlinked path on macOS
 * (`/var` → `/private/var`), which the path policy correctly refuses. Resolving
 * it here means the tests exercise the policy rather than tripping over it.
 */
export async function makeRoot(prefix = 'tela-mcp-'): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), prefix))
  return realpath(directory)
}

export async function connectInProcess(root?: string): Promise<Harness> {
  const approvedRoot = root ?? (await makeRoot())
  process.env.TELA_APPROVED_ROOT = approvedRoot
  resetSessions()

  const server = buildServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'tela-test-client', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  return {
    client,
    root: approvedRoot,
    close: async () => {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
      resetSessions()
      await rm(approvedRoot, { recursive: true, force: true }).catch(() => {})
    },
  }
}

export interface CallResult<T = Record<string, unknown>> {
  structured: T
  text: string
  isError: boolean
}

/** Call a tool and return both projections. Throws on an error result. */
export async function call<T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult<T>> {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ type: string; text?: string }>).map((block) => block.text ?? '').join('\n')
  if (result.isError) throw new Error(`${name} failed: ${text}`)
  return { structured: result.structuredContent as T, text, isError: false }
}

/** Call a tool expecting failure, and return the error text for assertion. */
export async function callExpectingError(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ type: string; text?: string }>).map((block) => block.text ?? '').join('\n')
  if (!result.isError) throw new Error(`${name} unexpectedly succeeded: ${text}`)
  return text
}

interface SessionBlock {
  session: { design: string; session_revision: number; disk_revision: string; unsaved_changes: boolean }
}

/**
 * Track the session revision across a sequence of mutations.
 *
 * Threading `expected_session_revision` by hand in every test would obscure what
 * each test is actually asserting; the revision *gate* itself is tested
 * explicitly and separately.
 */
export class Editor {
  private revision = 0

  private readonly client: Client
  readonly design: string

  constructor(client: Client, design: string) {
    this.client = client
    this.design = design
  }

  static async open(client: Client, design: string): Promise<Editor> {
    const opened = await call<SessionBlock>(client, 'tela_open_design', { design })
    const editor = new Editor(client, design)
    editor.revision = opened.structured.session.session_revision
    return editor
  }

  get sessionRevision(): number {
    return this.revision
  }

  async mutate<T extends SessionBlock>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await call<T>(this.client, name, { design: this.design, expected_session_revision: this.revision, ...args })
    this.revision = result.structured.session.session_revision
    return result.structured
  }

  async save(): Promise<{ session: SessionBlock['session']; bytes_written: number; document_sha256: string; content_unchanged: boolean }> {
    const summary = await call<{ disk_revision: string }>(this.client, 'tela_get_design_summary', { design: this.design })
    const saved = await call<{ session: SessionBlock['session']; bytes_written: number; document_sha256: string; content_unchanged: boolean }>(
      this.client,
      'tela_save_design',
      { design: this.design, expected_session_revision: this.revision, expected_disk_revision: summary.structured.disk_revision },
    )
    this.revision = saved.structured.session.session_revision
    return saved.structured
  }
}
