/**
 * Browser-bridge tests: render and export through the real pipeline.
 *
 * These drive the loopback server, the private Chromium, and the app's own
 * renderer. Nothing is stubbed — a passing run means a `.tela` document
 * authored in Node came out the other side as real image bytes.
 *
 * **Gating.** The suite needs a Chromium that Playwright can launch. If the
 * pinned browser is not installed and no explicit executable is configured, the
 * tests skip loudly rather than failing: a missing browser is an environment
 * gap, not a defect in the code under test, and a red suite that means
 * "you didn't download a browser" trains people to ignore red suites. The
 * wrap-up records which browser produced the evidence.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire as require$1Factory } from 'node:module'

const require$1 = require$1Factory(import.meta.url)

import { call, callExpectingError, connectInProcess, Editor, type Harness } from './harness'
import { abesLayers, TINY_PNG_BASE64 } from './abesFixture'
import { stopBridge } from '../../src/mcp/bridge/browser'

/** Resolve a launchable Chromium, or `null` when the environment has none. */
function resolveChromium(): string | null {
  const configured = process.env.TELA_CHROMIUM_EXECUTABLE?.trim()
  if (configured) return existsSync(configured) ? configured : null
  try {
    // `createRequire` rather than a bare `require`: this module is ESM, where
    // `require` is not defined, and a silently-caught ReferenceError would make
    // auto-detection appear to find no browser on every machine.
    const { createRequire } = require$1('node:module') as typeof import('node:module')
    const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
    const path = chromium.executablePath()
    return existsSync(path) ? path : null
  } catch {
    return null
  }
}

const CHROMIUM = resolveChromium()
const BRIDGE_BUILD = join(import.meta.dirname, '../../dist-bridge/index.html')
const CAN_RENDER = CHROMIUM !== null && existsSync(BRIDGE_BUILD)

if (!CAN_RENDER) {
  console.warn(
    `[render.test] skipped — ${CHROMIUM === null ? 'no launchable Chromium (set TELA_CHROMIUM_EXECUTABLE or run `npx playwright install chromium`)' : 'dist-bridge/ is missing (run `npm run build:bridge`)'}`,
  )
}

let harness: Harness
let frameId: string
let storyFrameId: string

const describeRender = CAN_RENDER ? describe : describe.skip

describeRender('browser bridge', () => {
  beforeAll(async () => {
    if (CHROMIUM) process.env.TELA_CHROMIUM_EXECUTABLE = CHROMIUM
    harness = await connectInProcess()

    await writeFile(join(harness.root, 'team.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    const created = await call<{ frame_id: string }>(harness.client, 'tela_create_design', {
      design: 'abes/render.tela',
      name: 'ABES — render',
    })
    frameId = created.structured.frame_id

    const editor = await Editor.open(harness.client, 'abes/render.tela')
    const asset = await editor.mutate<{ ref: string; session: never }>('tela_import_asset', { source: 'team.png', name: 'Team' })
    await editor.mutate('tela_add_layers', { frame_id: frameId, layers: abesLayers(asset.ref) })
    const variants = await editor.mutate<{ created: Array<{ frame_id: string }>; session: never }>('tela_generate_format_variants', {
      frame_id: frameId,
      format_ids: ['instagram-story'],
    })
    storyFrameId = variants.created[0].frame_id
    await editor.save()
  }, 180_000)

  afterAll(async () => {
    await stopBridge()
    await harness?.close()
  }, 60_000)

  it('starts the bridge lazily — only once a render is asked for', async () => {
    const before = await call<{ bridge_running: boolean }>(harness.client, 'tela_get_status')
    expect(before.structured.bridge_running).toBe(false)

    await call(harness.client, 'tela_render_preview', { design: 'abes/render.tela', frame_id: frameId, scale: 0.25 })

    const after = await call<{ bridge_running: boolean }>(harness.client, 'tela_get_status')
    expect(after.structured.bridge_running).toBe(true)
  }, 120_000)

  it('renders a preview of the ABES fixture as real PNG bytes', async () => {
    const preview = await call<{ width: number; height: number; bytes: number; mime: string; image_base64: string }>(
      harness.client,
      'tela_render_preview',
      { design: 'abes/render.tela', frame_id: frameId, format: 'png', scale: 0.25 },
    )
    expect(preview.structured.mime).toBe('image/png')
    expect(preview.structured.width).toBe(300)
    expect(preview.structured.height).toBe(157)
    expect(preview.structured.bytes).toBeGreaterThan(500)

    // Verify the PNG signature rather than trusting the reported mime type.
    const bytes = Buffer.from(preview.structured.image_base64, 'base64')
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }, 120_000)

  it.each([
    ['png', [0x89, 0x50, 0x4e, 0x47]],
    ['jpg', [0xff, 0xd8, 0xff]],
    ['webp', [0x52, 0x49, 0x46, 0x46]],
  ] as const)('exports %s with the right magic bytes and a deterministic name', async (format, magic) => {
    const exported = await call<{ files: Array<{ path: string; bytes: number; width: number; height: number }> }>(
      harness.client,
      'tela_export_frames',
      { design: 'abes/render.tela', frame_ids: [frameId], format, dpr: 1, destination: `exports/${format}` },
    )
    expect(exported.structured.files).toHaveLength(1)
    const [file] = exported.structured.files
    expect(file.path).toMatch(new RegExp(`^exports/${format}/.*-linkedin-feed-1x\\.${format}$`))
    expect(file.width).toBe(1200)
    expect(file.height).toBe(627)

    const bytes = await readFile(join(harness.root, file.path))
    expect([...bytes.subarray(0, magic.length)]).toEqual([...magic])
    expect(bytes.length).toBe(file.bytes)
  }, 180_000)

  it('exports browser-faithful SVG', async () => {
    const exported = await call<{ files: Array<{ path: string; bytes: number }> }>(harness.client, 'tela_export_frames', {
      design: 'abes/render.tela',
      frame_ids: [frameId],
      format: 'svg',
      destination: 'exports/svg',
    })
    const [file] = exported.structured.files
    // SVG carries no raster scale, so the name must not claim one other than 1x.
    expect(file.path).toMatch(/-linkedin-feed-1x\.svg$/)
    const markup = await readFile(join(harness.root, file.path), 'utf8')
    expect(markup).toContain('<svg')
    expect(markup).toContain('<?xml')
  }, 120_000)

  it('honours DPR, producing proportionally larger pixels', async () => {
    const single = await call<{ files: Array<{ width: number; height: number }> }>(harness.client, 'tela_export_frames', {
      design: 'abes/render.tela',
      frame_ids: [frameId],
      format: 'png',
      dpr: 1,
      destination: 'exports/dpr1',
    })
    const double = await call<{ files: Array<{ width: number; height: number }> }>(harness.client, 'tela_export_frames', {
      design: 'abes/render.tela',
      frame_ids: [frameId],
      format: 'png',
      dpr: 2,
      destination: 'exports/dpr2',
    })
    expect(double.structured.files[0].width).toBe(single.structured.files[0].width * 2)
    expect(double.structured.files[0].height).toBe(single.structured.files[0].height * 2)
  }, 180_000)

  it('re-exports to the same deterministic path rather than accumulating copies', async () => {
    const first = await call<{ files: Array<{ path: string }> }>(harness.client, 'tela_export_frames', {
      design: 'abes/render.tela',
      frame_ids: [frameId],
      format: 'png',
      dpr: 1,
      destination: 'exports/repeat',
    })
    const second = await call<{ files: Array<{ path: string }> }>(harness.client, 'tela_export_frames', {
      design: 'abes/render.tela',
      frame_ids: [frameId],
      format: 'png',
      dpr: 1,
      destination: 'exports/repeat',
    })
    expect(second.structured.files[0].path).toBe(first.structured.files[0].path)
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(join(harness.root, 'exports/repeat'))).toHaveLength(1)
  }, 180_000)

  it('renders deterministic artwork to byte-identical output on a repeat export', async () => {
    // Deliberately a frame with no stochastic layers. The ABES fixture carries a
    // grain-textured gradient, and grain is noise: it is *supposed* to differ
    // between renders, so asserting byte-identity on it would be asserting that
    // a feature is broken. What must hold is that the pipeline itself adds no
    // nondeterminism of its own — no timestamps, no counters, no random ids in
    // the encoded bytes — and that is what this checks.
    const created = await call<{ frame_id: string }>(harness.client, 'tela_create_design', {
      design: 'deterministic.tela',
      name: 'Deterministic',
    })
    const editor = await Editor.open(harness.client, 'deterministic.tela')
    await editor.mutate('tela_add_layers', {
      frame_id: created.structured.frame_id,
      layers: [
        { type: 'background', fill: { type: 'solid', color: { hex: '#101820', token: 'brand-dark' } }, width: 1200, height: 627 },
        { type: 'shape', x: 80, y: 400, width: 240, height: 56, shape: 'pill', fill: { hex: '#ff5a1f', token: 'ember-500' }, borderRadius: 9999 },
      ],
    })
    await editor.save()

    const paths: string[] = []
    for (const destination of ['exports/det-a', 'exports/det-b']) {
      const exported = await call<{ files: Array<{ path: string }> }>(harness.client, 'tela_export_frames', {
        design: 'deterministic.tela',
        frame_ids: [created.structured.frame_id],
        format: 'png',
        dpr: 1,
        destination,
      })
      paths.push(exported.structured.files[0].path)
    }
    const [a, b] = await Promise.all(paths.map((path) => readFile(join(harness.root, path))))
    expect(a.equals(b)).toBe(true)
  }, 240_000)

  it('exports a batch of frames in one browser context', async () => {
    const exported = await call<{ files: Array<{ frame_id: string; path: string; width: number }> }>(harness.client, 'tela_export_frames', {
      design: 'abes/render.tela',
      frame_ids: [frameId, storyFrameId],
      format: 'png',
      dpr: 1,
      destination: 'exports/batch',
    })
    expect(exported.structured.files).toHaveLength(2)
    expect(exported.structured.files.map((file) => file.frame_id)).toEqual([frameId, storyFrameId])
    // The story variant is genuinely a different size, so this is not two copies
    // of the same render with different names.
    expect(exported.structured.files[1].width).toBe(1080)
    for (const file of exported.structured.files) {
      await expect(stat(join(harness.root, file.path))).resolves.toBeTruthy()
    }
  }, 240_000)

  it('reports progress for a batch when the client supplies a progress token', async () => {
    const seen: Array<{ progress: number; total?: number }> = []
    const result = await harness.client.callTool(
      {
        name: 'tela_export_frames',
        arguments: { design: 'abes/render.tela', frame_ids: [frameId, storyFrameId], format: 'png', dpr: 1, destination: 'exports/progress' },
        _meta: { progressToken: 'export-progress' },
      },
      { onprogress: (progress: { progress: number; total?: number }) => seen.push(progress) },
    )
    expect(result.isError).toBeFalsy()
    expect(seen.length).toBeGreaterThan(0)
    // Monotonic: a client rendering a bar must never see it go backwards.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index].progress).toBeGreaterThan(seen[index - 1].progress)
    }
  }, 240_000)

  it('cancels an in-flight export and cleans up', async () => {
    const controller = new AbortController()
    const pending = harness.client.callTool(
      {
        name: 'tela_export_frames',
        arguments: { design: 'abes/render.tela', frame_ids: [frameId, storyFrameId], format: 'png', dpr: 3, destination: 'exports/cancelled' },
      },
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toThrow()

    // The bridge survives a cancellation: the next render still works, which is
    // what proves the aborted context was cleaned up rather than leaked.
    const after = await call<{ bytes: number }>(harness.client, 'tela_render_preview', {
      design: 'abes/render.tela',
      frame_id: frameId,
      scale: 0.25,
    })
    expect(after.structured.bytes).toBeGreaterThan(0)
  }, 240_000)

  it('loads a design into the editor session through the bridge', async () => {
    const opened = await call<{ loaded: boolean; page_count: number }>(harness.client, 'tela_open_editor', { design: 'abes/render.tela' })
    expect(opened.structured.loaded).toBe(true)
    expect(opened.structured.page_count).toBe(1)
  }, 120_000)

  it('stops the bridge on request and restarts it on the next render', async () => {
    await call(harness.client, 'tela_close_editor')
    expect((await call<{ bridge_running: boolean }>(harness.client, 'tela_get_status')).structured.bridge_running).toBe(false)

    await call(harness.client, 'tela_render_preview', { design: 'abes/render.tela', frame_id: frameId, scale: 0.25 })
    expect((await call<{ bridge_running: boolean }>(harness.client, 'tela_get_status')).structured.bridge_running).toBe(true)
  }, 180_000)

  it('refuses to render a frame that does not exist, without launching anything', async () => {
    const message = await callExpectingError(harness.client, 'tela_render_preview', { design: 'abes/render.tela', frame_id: 'no-such-frame' })
    expect(message).toMatch(/^\[not_found\]/)
    expect(message).toMatch(/tela_get_design_summary/)
  }, 60_000)
})

describe('bridge preconditions', () => {
  it('reports an actionable error when the bundled build is missing', async () => {
    const previous = process.env.TELA_BRIDGE_ROOT
    process.env.TELA_BRIDGE_ROOT = join(import.meta.dirname, 'no-such-build')
    await stopBridge()
    const local = await connectInProcess()
    try {
      const created = await call<{ frame_id: string }>(local.client, 'tela_create_design', { design: 'nobuild.tela', name: 'No build' })
      const message = await callExpectingError(local.client, 'tela_render_preview', {
        design: 'nobuild.tela',
        frame_id: created.structured.frame_id,
      })
      expect(message).toMatch(/^\[bridge_failed\]/)
      expect(message).toMatch(/build:bridge/)
      // Explicitly: it does not silently fall back to a dev server.
      expect(message).toMatch(/never falls back to a development server/)
    } finally {
      if (previous === undefined) delete process.env.TELA_BRIDGE_ROOT
      else process.env.TELA_BRIDGE_ROOT = previous
      await local.close()
    }
  }, 60_000)
})
