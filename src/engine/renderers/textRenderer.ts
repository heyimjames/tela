import type { TextLayer } from '@/types/design'
import { wrapText, getFontString } from '@/engine/textMeasure'

/**
 * Render text with manual per-character letter spacing.
 * This works across all browsers unlike ctx.letterSpacing.
 */
export function renderTextWithLetterSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
) {
  let currentX = x
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    ctx.fillText(char, currentX, y)
    const charWidth = ctx.measureText(char).width
    currentX += charWidth + spacing
  }
}

export function renderTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  scale: number,
) {
  const fontSize = layer.fontSize * scale
  const lineHeightPx = fontSize * layer.lineHeight
  const maxWidth = layer.width * scale
  const lsPerChar = layer.letterSpacing * fontSize

  ctx.save()

  // Apply text transform
  let text = layer.content
  if (layer.textTransform === 'uppercase') text = text.toUpperCase()
  else if (layer.textTransform === 'lowercase') text = text.toLowerCase()

  ctx.font = getFontString(fontSize, layer.fontWeight)
  ctx.fillStyle = layer.color.hex
  ctx.textBaseline = 'top'

  const lines = wrapText(ctx, text, maxWidth, fontSize, layer.fontWeight, layer.letterSpacing)

  // Vertical alignment offset
  const totalTextHeight = lines.length * lineHeightPx
  const layerHeight = layer.height * scale
  let yOffset = 0
  if (layer.verticalAlign === 'middle') {
    yOffset = Math.max(0, (layerHeight - totalTextHeight) / 2)
  } else if (layer.verticalAlign === 'bottom') {
    yOffset = Math.max(0, layerHeight - totalTextHeight)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const y = yOffset + i * lineHeightPx
    let x = 0

    if (layer.textAlign === 'center') {
      x = (maxWidth - line.width) / 2
    } else if (layer.textAlign === 'right') {
      x = maxWidth - line.width
    }

    // Render with manual letter spacing (ctx.letterSpacing not supported in all browsers)
    if (Math.abs(lsPerChar) > 0.1) {
      renderTextWithLetterSpacing(ctx, line.text, x, y, lsPerChar)
    } else {
      ctx.fillText(line.text, x, y)
    }

    // Text decoration
    if (layer.underline || layer.strikethrough) {
      ctx.save()
      ctx.strokeStyle = layer.color.hex
      ctx.lineWidth = Math.max(1, fontSize * 0.06)
      ctx.lineCap = 'round'

      if (layer.underline) {
        const underlineY = y + fontSize * 0.92
        ctx.beginPath()
        ctx.moveTo(x, underlineY)
        ctx.lineTo(x + line.width, underlineY)
        ctx.stroke()
      }

      if (layer.strikethrough) {
        const strikeY = y + fontSize * 0.55
        ctx.beginPath()
        ctx.moveTo(x, strikeY)
        ctx.lineTo(x + line.width, strikeY)
        ctx.stroke()
      }

      ctx.restore()
    }
  }

  ctx.restore()
}
