import type { TextLayer } from '@/types/design'

// Single source of truth for the text font — shared by wrap measurement, the
// Canvas-2D export renderer, the SVG scene, and the edit overlay so all four
// agree exactly (no wrap/overflow drift, editor text matches what renders).
export const FONT_FAMILY = "'Inter Variable', system-ui, sans-serif"

export function getFontString(fontSize: number, fontWeight: number): string {
  return `${fontWeight} ${fontSize}px ${FONT_FAMILY}`
}

/**
 * Properly configure a canvas context for text measurement.
 * Must be called before any measurement to ensure accurate results.
 */
export function setupTextContext(
  ctx: CanvasRenderingContext2D,
  fontSize: number,
  fontWeight: number,
  letterSpacing: number = 0,
): void {
  ctx.font = getFontString(fontSize, fontWeight)
  ctx.textBaseline = 'top'
  // Letter spacing workaround: we apply it manually during rendering
  // but need to account for it during measurement
}

export interface MeasuredLine {
  text: string
  width: number
}

/**
 * Wrap text into lines that fit within maxWidth.
 * Accounts for letter spacing in width calculations.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
  letterSpacing: number = 0,
): MeasuredLine[] {
  setupTextContext(ctx, fontSize, fontWeight, letterSpacing)

  const paragraphs = text.split('\n')
  const lines: MeasuredLine[] = []

  // Extra width per character from letter spacing
  const lsPerChar = letterSpacing * fontSize

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push({ text: '', width: 0 })
      continue
    }

    const words = paragraph.split(' ')
    let currentLine = ''

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const baseWidth = ctx.measureText(testLine).width
      // Add letter spacing: (charCount - 1) * lsPerChar
      const totalWidth = baseWidth + Math.max(0, testLine.length - 1) * lsPerChar

      if (totalWidth > maxWidth && currentLine) {
        const lineBase = ctx.measureText(currentLine).width
        const lineTotal = lineBase + Math.max(0, currentLine.length - 1) * lsPerChar
        lines.push({ text: currentLine, width: lineTotal })
        currentLine = word
      } else {
        currentLine = testLine
      }
    }

    if (currentLine) {
      const lineBase = ctx.measureText(currentLine).width
      const lineTotal = lineBase + Math.max(0, currentLine.length - 1) * lsPerChar
      lines.push({ text: currentLine, width: lineTotal })
    }
  }

  return lines
}

/**
 * Get the bounding box of a text layer.
 * Creates and properly configures a canvas context for accurate measurement.
 */
export function getTextBounds(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  scale: number = 1,
): { width: number; height: number } {
  const fontSize = layer.fontSize * scale

  // MUST set font before measuring
  setupTextContext(ctx, fontSize, layer.fontWeight, layer.letterSpacing)

  const lines = wrapText(
    ctx,
    layer.content,
    layer.width * scale,
    fontSize,
    layer.fontWeight,
    layer.letterSpacing,
  )

  const lineHeightPx = fontSize * layer.lineHeight

  let height: number
  if ((layer.verticalTrim ?? 'cap') === 'cap') {
    // Cap trim: the box hugs cap-height → baseline, matching the CSS
    // text-box-edge 'cap alphabetic' used when rendering. Extra lines add
    // full line-height; the last line contributes only cap height (no leading,
    // descenders overflow) so a single line is as tight as the glyphs.
    // Cap height must be read against the ALPHABETIC baseline — setupTextContext
    // uses 'top', where actualBoundingBoxAscent is ~0 (that yielded negative box
    // heights). Switch baseline just for this metric.
    const prevBaseline = ctx.textBaseline
    ctx.textBaseline = 'alphabetic'
    const cap = ctx.measureText('H').actualBoundingBoxAscent || fontSize * 0.72
    ctx.textBaseline = prevBaseline
    height = lines.length > 0 ? (lines.length - 1) * lineHeightPx + cap : 0
  } else {
    // Standard: keep the font's natural line box (leading included).
    const metrics = ctx.measureText('Mgy')
    const actualLineHeight = Math.max(
      lineHeightPx,
      (metrics.actualBoundingBoxAscent ?? fontSize * 0.8) + (metrics.actualBoundingBoxDescent ?? fontSize * 0.2),
    )
    height = lines.length > 0 ? (lines.length - 1) * lineHeightPx + actualLineHeight : 0
  }

  let maxWidth = 0
  for (const line of lines) {
    if (line.width > maxWidth) maxWidth = line.width
  }

  return { width: maxWidth / scale, height: height / scale }
}

/**
 * Create a properly configured offscreen canvas for text measurement.
 */
export function createMeasureContext(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas.getContext('2d')!
}
