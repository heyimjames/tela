import { exportDesign } from '@/engine/compositor'
import { buildSvgMarkup } from '@/engine/svgExport'
import { preloadImage } from '@/engine/renderers/imageCache'
import { applySession } from '@/tela/session'
import type { CommandDef } from './commands'
import type { DesignDocument, Layer } from '@/types/design'

/**
 * Bridge-only operations on the internal command bus.
 *
 * These exist so the MCP server's browser bridge can reach the renderer through
 * the one channel the architecture allows — `page.evaluate(window.tela.dispatch)`
 * — instead of a wildcard postMessage or an injected script.
 *
 * They are **internal**. The MCP server exposes `tela_render_preview` and
 * `tela_export_frames`, which call these; it exposes no tool that lets a client
 * name an arbitrary op. The command bus is not, and must not become, a publicly
 * reachable generic dispatch surface.
 *
 * `renderDocument` takes a whole document rather than a frame id on purpose. The
 * canonical state lives in the MCP process; asking the browser to look up a
 * frame would mean the browser had to *have* the current design, which
 * reintroduces exactly the stale-session problem the Node-side authoring model
 * removes. Here the browser is handed the pixels' worth of state and nothing else.
 */

/** Every URL the renderer will need to have decoded before it draws. */
function referencedImageUrls(layers: Layer[]): string[] {
  const urls = new Set<string>()
  const consider = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('data:image/')) urls.add(value)
  }
  for (const layer of layers) {
    const record = layer as unknown as Record<string, unknown>
    consider(record.imageUrl)
    const fill = record.fill as Record<string, unknown> | undefined
    if (fill && fill.type === 'image') consider(fill.imageUrl)
  }
  return [...urls]
}

/**
 * Wait for the two things the export path never waits for itself.
 *
 * The canvas renderer reads `getOrLoadImage`, which returns `null` on a cache
 * miss and populates asynchronously; and it draws text with whatever fonts
 * happen to be loaded. Rendering without this step produces blank images and
 * fallback-font text *intermittently* — the worst kind of wrong, because it
 * passes locally and fails under load.
 */
async function warmRenderer(layers: Layer[]): Promise<{ images: number; fontsReady: boolean }> {
  const urls = referencedImageUrls(layers)
  const results = await Promise.allSettled(urls.map((url) => preloadImage(url)))
  let fontsReady = false
  try {
    await document.fonts.ready
    fontsReady = true
  } catch {
    fontsReady = false
  }
  return { images: results.filter((result) => result.status === 'fulfilled').length, fontsReady }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

export const RENDER_COMMANDS: Record<string, CommandDef> = {
  renderDocument: {
    description: 'Internal bridge op: rasterize or vectorize a supplied document. Not exposed as an MCP tool.',
    params: {
      document: 'DesignDocument — the frame to render, supplied whole by the caller',
      format: 'png|jpg|webp|svg',
      quality: 'number 0-1 (jpg/webp only)',
      dpr: 'number — device pixel ratio multiplier',
    },
    handler: async (a) => {
      const doc = a.document as DesignDocument
      if (!doc || !Array.isArray(doc.layers) || !doc.format) {
        throw new Error('renderDocument requires a document with `format` and `layers`')
      }
      const warmed = await warmRenderer(doc.layers)
      const format = (a.format as string) ?? 'png'

      if (format === 'svg') {
        const svg = await buildSvgMarkup(doc)
        return {
          format: 'svg',
          mime: 'image/svg+xml',
          base64: btoa(unescape(encodeURIComponent(svg))),
          width: doc.format.width,
          height: doc.format.height,
          ...warmed,
        }
      }

      const dpr = typeof a.dpr === 'number' && a.dpr > 0 ? a.dpr : 1
      const quality = typeof a.quality === 'number' ? a.quality : 0.92
      const blob = await exportDesign(doc, { format: format as 'png' | 'jpg' | 'webp', quality, dpr })
      return {
        format,
        mime: blob.type || `image/${format === 'jpg' ? 'jpeg' : format}`,
        base64: await blobToBase64(blob),
        width: Math.round(doc.format.width * dpr),
        height: Math.round(doc.format.height * dpr),
        ...warmed,
      }
    },
  },

  applyDocument: {
    description: 'Internal bridge op: replace the editing session with a supplied .tela document. Not exposed as an MCP tool.',
    params: { document: 'TelaDocument — a validated portable document' },
    handler: (a) => {
      const applied = applySession(a.document)
      return { documentId: applied.id, pages: applied.pages.length }
    },
  },
}
