/**
 * Rendering and export.
 *
 * The document handed to the browser is assembled here, in Node, from the
 * canonical session state. That is the whole trick: the browser never looks
 * anything up, so there is no active-frame, active-page, or write-back timing to
 * get wrong — it receives a complete, self-contained document and returns pixels.
 *
 * Export filenames are deterministic: the same design, frame, format, and scale
 * always produce the same name. A re-export overwrites its own previous output
 * instead of accumulating `frame (3).png`, which is what makes an export path
 * safe to put in a Linear handoff field.
 */

import { writeFileAtomic } from '../../tela/nodeIo'
import type { TelaDocument, TelaFrame } from '../../tela/schema'
import { toolError } from '../errors'
import { requireFrame } from '../documentOps'
import { resolveInRoot } from '../paths'
import { withOperation, throwIfAborted } from './browser'

export type RasterFormat = 'png' | 'jpg' | 'webp'
export type ExportFormat = RasterFormat | 'svg'

export const EXPORT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** The renderer's document shape: one frame, flattened. */
function frameDocument(document: TelaDocument, frame: TelaFrame): Record<string, unknown> {
  return {
    id: frame.id,
    name: frame.name,
    format: frame.format,
    // The frame's own background is a property of the frame in the persisted
    // model but a layer to the renderer, so it is prepended rather than lost.
    layers: [backgroundLayerFor(frame), ...frame.layers].filter(Boolean),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    ...(frame.autoLayouts ? { autoLayouts: frame.autoLayouts } : {}),
  }
}

function backgroundLayerFor(frame: TelaFrame): Record<string, unknown> | null {
  // A frame that already carries an explicit background layer keeps it; adding a
  // second would paint over whatever the author put underneath.
  if (frame.layers.some((layer) => layer.type === 'background')) return null
  return {
    id: `${frame.id}-frame-background`,
    type: 'background',
    name: 'Frame background',
    visible: true,
    locked: true,
    opacity: 1,
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
    rotation: 0,
    zIndex: -1,
    fill: frame.backgroundFill,
  }
}

export interface RenderRequest {
  document: TelaDocument
  frameId: string
  format: ExportFormat
  quality: number
  dpr: number
}

export interface RenderedImage {
  frameId: string
  frameName: string
  /** The ad-format id of the frame, e.g. `linkedin-feed`. Part of the deterministic filename. */
  formatId: string
  format: ExportFormat
  mime: string
  width: number
  height: number
  bytes: number
  base64: string
}

interface BridgeRenderResult {
  format: string
  mime: string
  base64: string
  width: number
  height: number
  images: number
  fontsReady: boolean
}

/** Render a single frame. One browser context, closed in `finally` by `withOperation`. */
export async function renderFrame(request: RenderRequest, signal: AbortSignal): Promise<RenderedImage> {
  const results = await renderFrames({ ...request, frameIds: [request.frameId] }, signal)
  return results[0]
}

export interface RenderManyRequest {
  document: TelaDocument
  frameIds: string[]
  format: ExportFormat
  quality: number
  dpr: number
  /** Called after each frame, so a long batch reports monotonic progress. */
  onProgress?: (done: number, total: number, frameName: string) => void | Promise<void>
}

/**
 * Render a batch of frames inside **one** browser context.
 *
 * A context per frame would be cleaner in isolation terms but costs a full page
 * boot per frame; the frames in a batch come from one document and one caller,
 * so the isolation a fresh context buys between them is worth nothing.
 */
export async function renderFrames(request: RenderManyRequest, signal: AbortSignal): Promise<RenderedImage[]> {
  if (request.frameIds.length === 0) {
    throw toolError('invalid_input', 'no frames to render', 'pass at least one frame id in frame_ids')
  }
  const located = request.frameIds.map((frameId) => requireFrame(request.document, frameId).frame)
  const widest = located.reduce((max, frame) => Math.max(max, frame.width), 0)
  const tallest = located.reduce((max, frame) => Math.max(max, frame.height), 0)

  return withOperation(
    signal,
    async ({ dispatch }) => {
      const out: RenderedImage[] = []
      for (const [index, frame] of located.entries()) {
        throwIfAborted(signal)
        const result = await dispatch<BridgeRenderResult>({
          op: 'renderDocument',
          document: frameDocument(request.document, frame),
          format: request.format,
          quality: request.quality,
          dpr: request.dpr,
        })
        out.push({
          frameId: frame.id,
          frameName: frame.name,
          formatId: frame.format.id,
          format: request.format,
          mime: result.mime || EXPORT_MIME[request.format],
          width: result.width,
          height: result.height,
          bytes: Buffer.from(result.base64, 'base64').length,
          base64: result.base64,
        })
        await request.onProgress?.(index + 1, located.length, frame.name)
      }
      return out
    },
    {
      // Give the page a viewport at least as large as the largest frame: some
      // layout paths measure against the viewport, and a frame larger than the
      // window can otherwise clip.
      viewport: { width: Math.min(Math.max(1280, Math.ceil(widest)), 4096), height: Math.min(Math.max(800, Math.ceil(tallest)), 4096) },
      deviceScaleFactor: 1,
    },
  )
}

/** Open the design in a visible editor window. Returns once the app has the document. */
export async function openEditor(document: TelaDocument, signal: AbortSignal): Promise<{ pages: number }> {
  return withOperation(signal, async ({ dispatch }) => dispatch<{ documentId: string; pages: number }>({ op: 'applyDocument', document }))
}

/**
 * The slug half of an export filename. Exported as its own step because
 * collision detection has to key on *this*, not on the frame name: "Hero A" and
 * "Hero-A" are distinct names that slug to the same thing.
 */
export function exportSlug(frameName: string): string {
  return (
    frameName
      .toLowerCase()
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'frame'
  )
}

/**
 * Deterministic export filename.
 *
 * Slug from the frame name, then the format id and the scale. Two different
 * frames whose names slug the same in one batch would collide, so the frame id's
 * prefix is appended when the slug is not unique within the batch — the id is
 * the only thing guaranteed distinct.
 */
export function exportFileName(frameName: string, formatId: string, extension: string, dpr: number, disambiguator?: string): string {
  const slug = exportSlug(frameName)
  const suffix = disambiguator ? `-${disambiguator.replace(/[^\w]/g, '').slice(0, 8)}` : ''
  return `${slug}${suffix}-${formatId}-${dpr}x.${extension}`
}

export function extensionFor(format: ExportFormat): string {
  return format === 'jpg' ? 'jpg' : format
}

export interface WrittenExport extends Omit<RenderedImage, 'base64'> {
  path: string
}

/** Write rendered images into an approved-root-relative directory. */
export async function writeExports(images: RenderedImage[], destination: string, dpr: number): Promise<WrittenExport[]> {
  // Count first, then write: whether a name needs disambiguating depends on the
  // whole batch, which is not knowable while streaming through it.
  // Keyed on the *slug*, not the raw frame name: "Hero A" and "Hero-A" are two
  // keys by name but one filename, so a name-keyed map reports no collision and
  // the second write silently overwrites the first while both frames are
  // reported as written — the path for frame A holding frame B's pixels.
  const nameKey = (image: RenderedImage) => `${exportSlug(image.frameName)}|${image.formatId}|${extensionFor(image.format)}`
  const names = new Map<string, number>()
  for (const image of images) {
    const key = nameKey(image)
    names.set(key, (names.get(key) ?? 0) + 1)
  }

  const written: WrittenExport[] = []
  for (const image of images) {
    const collides = (names.get(nameKey(image)) ?? 0) > 1
    const fileName = exportFileName(
      image.frameName,
      image.formatId,
      extensionFor(image.format),
      dpr,
      collides ? image.frameId : undefined,
    )
    const resolved = await resolveInRoot(`${destination}/${fileName}`, 'destination', { forWrite: true, createParents: true })
    // No journal for exports. A record is only worth writing where something
    // later reads it, and the only sweep in the server runs on the open path of
    // a *design*, scoped to that design's own file — nothing ever inspects an
    // export directory. Journalling here would leave a `.journal` beside the
    // stray `.tmp` after a kill, which is one more unexplained file rather than
    // one fewer. An interrupted export is also nothing to recover: re-running
    // the render reproduces it exactly.
    await writeFileAtomic(resolved.absolute, Buffer.from(image.base64, 'base64'), { createDirectory: true, journal: false })
    const { base64: _omitted, ...rest } = image
    written.push({ ...rest, path: resolved.relative })
  }
  return written
}
