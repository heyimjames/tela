import type { DesignDocument } from '@/types/design'
import { renderLayer } from '@/engine/layerRenderer'

/**
 * Render a design document to a high-quality thumbnail.
 * Uses the actual design dimensions for full-res output,
 * capped at a reasonable pixel budget for performance.
 */
export function renderThumbnail(
  doc: DesignDocument,
  displayWidth: number = 600,
  displayHeight: number = 400,
): string {
  const aspect = doc.format.width / doc.format.height
  let thumbW: number, thumbH: number

  if (aspect > displayWidth / displayHeight) {
    thumbW = displayWidth
    thumbH = Math.round(displayWidth / aspect)
  } else {
    thumbH = displayHeight
    thumbW = Math.round(displayHeight * aspect)
  }

  // Render at high DPI for crisp previews
  const dpr = Math.min(window.devicePixelRatio || 2, 3)
  const canvasW = Math.round(thumbW * dpr)
  const canvasH = Math.round(thumbH * dpr)

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!

  const scale = canvasW / doc.format.width

  const sortedLayers = [...doc.layers].sort((a, b) => a.zIndex - b.zIndex)

  for (const layer of sortedLayers) {
    renderLayer(ctx, layer, canvasW, canvasH, scale)
  }

  // PNG for full quality (no JPEG compression artifacts)
  return canvas.toDataURL('image/png')
}
