import type { DesignDocument } from '@/types/design'
import { renderLayer, type RenderOptions } from '@/engine/layerRenderer'
import { captureDesignShaders } from '@/engine/shaderCapture'

/**
 * Composite all layers of a design document onto a single canvas.
 * Used for both preview (scale = zoom) and export (scale = dpr).
 */
export function compositeDesign(
  doc: DesignDocument,
  scale: number,
  opts?: RenderOptions,
): HTMLCanvasElement {
  const w = doc.format.width * scale
  const h = doc.format.height * scale

  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')!

  // Sort layers by zIndex
  const sortedLayers = [...doc.layers].sort((a, b) => a.zIndex - b.zIndex)

  for (const layer of sortedLayers) {
    renderLayer(ctx, layer, w, h, scale, opts)
  }

  return canvas
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w)
  canvas.height = Math.round(h)
  return canvas
}

/**
 * Render design to a canvas context directly (for the preview canvas).
 * Clears the canvas first, then composites all layers.
 */
export function renderToContext(
  ctx: CanvasRenderingContext2D,
  doc: DesignDocument,
  scale: number,
  opts?: RenderOptions,
) {
  const w = doc.format.width * scale
  const h = doc.format.height * scale

  ctx.clearRect(0, 0, w, h)

  const sortedLayers = [...doc.layers].sort((a, b) => a.zIndex - b.zIndex)

  for (const layer of sortedLayers) {
    if (opts?.hideLayerId && layer.id === opts.hideLayerId) continue
    renderLayer(ctx, layer, w, h, scale, opts)
  }
}

// --- Export ---

export interface ExportOptions {
  format: 'png' | 'jpg' | 'webp'
  quality: number
  dpr: number
}

export async function exportDesign(
  doc: DesignDocument,
  options: ExportOptions,
): Promise<Blob> {
  // Shader backgrounds are WebGL — capture a deterministic still at export
  // resolution first, then composite it like any other bitmap.
  const shaderCanvases = await captureDesignShaders(
    doc.layers,
    doc.format.width * options.dpr,
    doc.format.height * options.dpr,
  )
  const canvas = compositeDesign(doc, options.dpr, { shaderCanvases })

  const mimeType = options.format === 'png'
    ? 'image/png'
    : options.format === 'jpg'
      ? 'image/jpeg'
      : 'image/webp'

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob!),
      mimeType,
      options.format === 'png' ? undefined : options.quality,
    )
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportAndDownload(
  doc: DesignDocument,
  options: ExportOptions,
) {
  const blob = await exportDesign(doc, options)
  const ext = options.format === 'jpg' ? 'jpg' : options.format
  const filename = `${doc.name.replace(/\s+/g, '-').toLowerCase()}-${doc.format.id}-${options.dpr}x.${ext}`
  downloadBlob(blob, filename)
}
