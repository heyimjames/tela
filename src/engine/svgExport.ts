import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SvgScene, type NaturalImageSize } from '@/components/canvas/DesignSvgScene'
import { captureDesignShaders } from '@/engine/shaderCapture'
import type { DesignDocument, ImageLayer } from '@/types/design'

/**
 * Serialise a design document to a standalone, vector SVG string by rendering
 * the SAME <SvgScene> the editor uses. Reusing the live renderer guarantees the
 * exported file matches the canvas exactly — no second renderer to drift.
 *
 * Text and imported SVGs ride inside <foreignObject> (real HTML/SVG), so the
 * output renders faithfully in browsers and embeds cleanly in HTML. (Editors
 * like Illustrator that ignore <foreignObject> won't show that text — a known
 * tradeoff of HTML-accurate text; a <text>-based path can be added later.)
 */
function loadNaturalImageSize(url: string): Promise<NaturalImageSize | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

async function loadCroppedImageSizes(doc: DesignDocument): Promise<Record<string, NaturalImageSize>> {
  const urls = new Set(
    doc.layers
      .filter(
        (layer): layer is ImageLayer =>
          layer.type === 'image' &&
          (layer.cropX !== 0 || layer.cropY !== 0 || layer.cropW !== 1 || layer.cropH !== 1),
      )
      .map((layer) => layer.imageUrl),
  )

  const entries = await Promise.all(
    [...urls].map(async (url) => [url, await loadNaturalImageSize(url)] as const),
  )
  return Object.fromEntries(
    entries.filter((entry): entry is [string, NaturalImageSize] => Boolean(entry[1])),
  )
}

export async function buildSvgMarkup(doc: DesignDocument): Promise<string> {
  // Shader backgrounds have no vector form — capture each to a still and embed
  // it as an <image>. (Everything else is real vector.) Cropped image layers need
  // natural dimensions before static markup render, because React effects don't
  // run inside renderToStaticMarkup.
  const fw = doc.format?.width ?? 1200
  const fh = doc.format?.height ?? 627
  const [canvases, imageSizes] = await Promise.all([
    captureDesignShaders(doc.layers, fw, fh),
    loadCroppedImageSizes(doc),
  ])
  const shaderStills: Record<string, string> = {}
  canvases.forEach((canvas, id) => {
    shaderStills[id] = canvas.toDataURL('image/png')
  })

  const body = renderToStaticMarkup(
    createElement(SvgScene, { doc, zoom: 1, standalone: true, shaderStills, imageSizes }),
  )
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`
}

function safeFileName(name: string): string {
  return (name || 'design').trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'design'
}

export async function exportSvgAndDownload(doc: DesignDocument): Promise<void> {
  const markup = await buildSvgMarkup(doc)
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement('a')
  a.href = url
  a.download = `${safeFileName(doc.name)}.svg`
  a.click()
  URL.revokeObjectURL(url)
}
