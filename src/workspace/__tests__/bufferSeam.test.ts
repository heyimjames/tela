/**
 * The `Buffer`/`Uint8Array` seam, asserted on the bytes that reach the wire.
 *
 * CLI-516's lesson, verbatim: *a test that only ever passes the convenient type is
 * blind to the type the consumer actually passes*. The generated client once sent
 * binary bodies as `bytes.slice().buffer`. `Uint8Array.prototype.slice` copies, but
 * Node's `Buffer` overrides `slice` as `subarray` — a view — so a sub-4 KiB `Buffer`
 * from `readFileSync`, which lives inside Node's shared 8 KiB pool, would have put
 * 8192 bytes of unrelated memory on the wire. Every test passed a `Uint8Array`, so
 * nothing caught it.
 *
 * This app is the consumer that holds those types. So the assertions here are:
 *
 *  1. the environment really does produce a pooled `Buffer` for a small file — the
 *     precondition, checked first, because an assertion about pooled buffers that
 *     silently ran on an unpooled one would prove nothing (and did: the first run of
 *     the integration script used a 15 KiB bundle, which Node allocates standalone);
 *  2. the adapter puts exactly those bytes on the wire, for a pooled `Buffer`, a
 *     `Uint8Array` view into a larger buffer, and a plain `Uint8Array`.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesignApiClient } from '../client'
import { WorkspaceStorageAdapter } from '@/storage/WorkspaceStorageAdapter'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'

/** Captures the body the client actually sends. */
function recordingAdapter() {
  const bodies: Uint8Array[] = []
  const client = createDesignApiClient({
    baseUrl: '/',
    fetch: async (_input, init) => {
      const body = init?.body
      if (body instanceof Uint8Array) {
        const copy = new Uint8Array(body.byteLength)
        copy.set(body)
        bodies.push(copy)
      } else if (body != null) {
        bodies.push(new Uint8Array(await new Response(body as BodyInit).arrayBuffer()))
      }
      return new Response(
        JSON.stringify({ contentRevision: 'r'.repeat(64), bundleSha256: 's'.repeat(64) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  const adapter = new WorkspaceStorageAdapter({
    client: () => client,
    workspaceId: () => WORKSPACE,
  })
  return { adapter, bodies }
}

describe('binary body seam', () => {
  it('a small file read from disk yields a pooled Buffer', () => {
    // The precondition the seam bug needed. Asserted rather than assumed: Node
    // allocates standalone for anything at or above `Buffer.poolSize >>> 1`, so a
    // "pooled buffer" test written with a large fixture tests nothing.
    const directory = mkdtempSync(join(tmpdir(), 'tela-seam-'))
    const path = join(directory, 'small.bin')
    const contents = Buffer.alloc(64, 7)
    writeFileSync(path, contents)

    const loaded = readFileSync(path)

    expect(loaded.byteLength).toBe(64)
    // Pooled: the backing ArrayBuffer is much larger than the 64 bytes we asked for.
    expect(loaded.buffer.byteLength).toBeGreaterThan(loaded.byteLength)
    expect(loaded.buffer.byteLength).toBeGreaterThanOrEqual(1024)
  })

  it('sends exactly a pooled Buffer’s own bytes, not its pool', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tela-seam-'))
    const path = join(directory, 'small.bin')
    const contents = Buffer.from(Array.from({ length: 100 }, (_, index) => index % 251))
    writeFileSync(path, contents)
    const pooled = readFileSync(path)
    expect(pooled.buffer.byteLength).toBeGreaterThan(pooled.byteLength)

    const { adapter, bodies } = recordingAdapter()
    await adapter.putDocument('doc-1', pooled, null)

    expect(bodies).toHaveLength(1)
    // The exact failure the old client had: 8192 instead of 100.
    expect(bodies[0]!.byteLength).toBe(100)
    expect([...bodies[0]!]).toEqual([...contents])
  })

  it('sends exactly a subarray view’s own bytes', async () => {
    const backing = new Uint8Array(1024).fill(9)
    backing.set([1, 2, 3, 4, 5], 500)
    const view = backing.subarray(500, 505)
    expect(view.byteOffset).toBe(500)

    const { adapter, bodies } = recordingAdapter()
    await adapter.putDocument('doc-1', view, null)

    expect(bodies[0]!.byteLength).toBe(5)
    expect([...bodies[0]!]).toEqual([1, 2, 3, 4, 5])
  })

  it('sends a plain Uint8Array unchanged', async () => {
    const bytes = new Uint8Array([10, 20, 30])
    const { adapter, bodies } = recordingAdapter()

    await adapter.putDocument('doc-1', bytes, null)

    expect([...bodies[0]!]).toEqual([10, 20, 30])
  })

  it('hashes a pooled Buffer over its own bytes, so the rename check is not spurious', async () => {
    // `serverStoredOurBytes` compares a locally computed sha256 against the
    // server's. If the local hash covered the pool, every save would report "your
    // bytes were not stored" and users would be told their work is not durable
    // when it is.
    const { sha256Hex } = await import('../bundleHash')
    const { createHash } = await import('node:crypto')
    const directory = mkdtempSync(join(tmpdir(), 'tela-seam-'))
    const path = join(directory, 'small.bin')
    const contents = Buffer.from('hash me', 'utf8')
    writeFileSync(path, contents)
    const pooled = readFileSync(path)
    expect(pooled.buffer.byteLength).toBeGreaterThan(pooled.byteLength)

    expect(await sha256Hex(pooled)).toBe(createHash('sha256').update(contents).digest('hex'))
  })
})
